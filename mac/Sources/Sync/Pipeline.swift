import Foundation

enum SyncEvent: Sendable {
    case hashing(String?)
    case upload(UploadEvent)
    case scanned(source: String)
}

/// Scan, hash, check, upload. No UI types in here, so the headless `sync` command and the
/// app share the same code.
final class Pipeline: @unchecked Sendable {
    let api: Api
    let store: StateStore
    let gate: RunGate
    let onEvent: @Sendable (SyncEvent) -> Void
    lazy var uploader = Uploader(api: api, store: store, gate: gate) { [onEvent] in onEvent(.upload($0)) }

    init(api: Api, store: StateStore, gate: RunGate, onEvent: @escaping @Sendable (SyncEvent) -> Void) {
        self.api = api; self.store = store; self.gate = gate; self.onEvent = onEvent
    }

    static func source(forFolder path: String) -> String { "folder:" + path }

    struct Found { let url: URL; let size: Int64; let mtime: Double }

    /// Every media file below `root`, skipping hidden names and Photos library packages.
    static func enumerate(_ root: URL) -> [Found] {
        let fm = FileManager.default
        guard let it = fm.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey],
                                     options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { return [] }
        var out: [Found] = []
        for case let u as URL in it {
            guard MediaFile.isMedia(u), !MediaFile.isSkippedName(u.lastPathComponent),
                  let v = try? u.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey]),
                  v.isRegularFile == true, let size = v.fileSize, size > 0, let m = v.contentModificationDate else { continue }
            out.append(Found(url: u, size: Int64(size), mtime: m.timeIntervalSince1970))
        }
        return out.sorted { $0.url.path < $1.url.path }
    }

    struct Report { var files = 0; var hashed = 0; var uploaded = 0; var alreadyThere = 0; var failed = 0 }

    func syncFolder(_ path: String) async -> Report {
        var rep = Report()
        let src = Self.source(forFolder: path)
        let found = Self.enumerate(URL(fileURLWithPath: path))
        rep.files = found.count
        var bySha: [String: Found] = [:]
        var pendingShas: [String] = []
        for f in found {
            if Task.isCancelled { return rep }
            await gate.wait()
            // A file touched in the last 3 seconds is probably still being written; the next event picks it up.
            if Date().timeIntervalSince1970 - f.mtime < 3 { continue }
            let key = "f:" + f.url.path
            var entry = store.lookup(key: key, size: f.size, mtime: f.mtime)
            if entry == nil {
                onEvent(.hashing(f.url.lastPathComponent))
                guard let sha = try? Hasher256.file(f.url) else { continue }
                // The file changed while it was being read: leave it for the next pass.
                if let v = try? f.url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey]),
                   Int64(v.fileSize ?? -1) != f.size || v.contentModificationDate?.timeIntervalSince1970 != f.mtime { continue }
                store.put(key: key, source: src, size: f.size, mtime: f.mtime, sha: sha)
                entry = store.lookup(key: key)
                rep.hashed += 1
            }
            guard let e = entry else { continue }
            if e.uploaded { rep.alreadyThere += 1; continue }
            if bySha[e.sha] == nil { bySha[e.sha] = f; pendingShas.append(e.sha) }
        }
        onEvent(.hashing(nil))
        let r = await checkAndUpload(shas: pendingShas) { bySha[$0].map {
            UploadJob(sha: "", url: $0.url, size: Int($0.size), name: $0.url.lastPathComponent,
                      mtimeMs: Int64($0.mtime * 1000), source: "mac") } }
        rep.uploaded += r.done; rep.failed += r.failed; rep.alreadyThere += r.present
        onEvent(.scanned(source: src))
        return rep
    }

    /// Batches of 200 against /api/upload/check, then the missing ones to the uploader.
    func checkAndUpload(shas: [String], job: (String) -> UploadJob?) async -> (done: Int, failed: Int, present: Int) {
        var done = 0, failed = 0, present = 0
        var start = 0
        while start < shas.count {
            let batch = Array(shas[start..<min(start + 200, shas.count)])
            start += 200
            do {
                let missing = try await api.check(hashes: batch)
                for s in batch where !missing.contains(s) { store.markUploaded(sha: s, itemId: nil); present += 1 }
                let jobs = batch.filter { missing.contains($0) }.compactMap { s -> UploadJob? in
                    guard let j = job(s) else { return nil }
                    return UploadJob(sha: s, url: j.url, size: j.size, name: j.name, mtimeMs: j.mtimeMs, source: j.source, deleteWhenDone: j.deleteWhenDone)
                }
                let r = await uploader.upload(jobs)
                done += r.done; failed += r.failed
            } catch { failed += batch.count }
        }
        return (done, failed, present)
    }
}

/// OCR for uploaded photos: GET /api/index/pending, Vision on the local file (or /media/id/l), POST the text.
final class OcrWorker: @unchecked Sendable {
    let api: Api, store: StateStore, gate: RunGate
    private var failed = Set<Int>()
    private let lock = NSLock()
    var onItem: @Sendable (Int) -> Void = { _ in }

    init(api: Api, store: StateStore, gate: RunGate) { self.api = api; self.store = store; self.gate = gate }

    /// One pass over what is pending. Returns how many texts were posted.
    func runOnce() async -> Int {
        guard let pending = try? await api.pending(limit: 50) else { return 0 }
        var n = 0
        for item in OcrWanted.filter(pending) {
            if Task.isCancelled { break }
            let skip = lock.withLock { failed.contains(item.id) }
            if skip { continue }
            await gate.wait()
            do {
                let text = try await recognize(item.id)
                try await api.postOcr(id: item.id, text: text)
                n += 1; onItem(item.id)
            } catch {
                lock.withLock { _ = failed.insert(item.id) }
            }
        }
        return n
    }

    private func recognize(_ id: Int) async throws -> String {
        if let e = store.entries(forItem: id).first, e.key.hasPrefix("f:") {
            let url = URL(fileURLWithPath: String(e.key.dropFirst(2)))
            if FileManager.default.fileExists(atPath: url.path), let t = try? Ocr.recognize(url: url) { return t }
        }
        let data = try await api.media(id: id, size: "l")
        return try Ocr.recognize(data: data)
    }
}
