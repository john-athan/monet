import Foundation

/// The second copy: originals the server has, written to <folder>/<yyyy>/<mm>/<sha256>.<ext>.
enum ArchiveCopier {
    struct Result { var copied = 0; var skipped = 0; var failed = 0; var lastId = 0 }

    static func cursorKey(_ root: URL) -> String { "archive.after:" + root.path }

    /// Volume name for an external disk, otherwise the folder name.
    static func displayName(root: URL) -> String {
        if root.path.hasPrefix("/Volumes/"),
           let n = try? root.resourceValues(forKeys: [.volumeNameKey]).volumeName { return n }
        return root.lastPathComponent
    }

    static func isAvailable(root: URL) -> Bool {
        var isDir: ObjCBool = false
        return FileManager.default.fileExists(atPath: root.path, isDirectory: &isDir) && isDir.boolValue
    }

    static func run(api: Api, store: StateStore, root: URL, gate: RunGate,
                    onProgress: @Sendable (Int) -> Void = { _ in }) async throws -> Result {
        guard isAvailable(root: root) else { throw CocoaError(.fileNoSuchFile) }
        let fm = FileManager.default
        let tmpDir = root.appendingPathComponent(".monet-tmp", isDirectory: true)
        var res = Result()
        var after = Int(store.meta(cursorKey(root)) ?? "") ?? 0
        var blocked = false     // once something failed the cursor stops moving
        while true {
            try Task.checkCancellation()
            let list = try await api.exportList(after: after).sorted { $0.id < $1.id }
            let fresh = list.filter { $0.id > after }
            if fresh.isEmpty { break }
            var acked: [Int] = []
            for e in fresh {
                await gate.wait()
                try Task.checkCancellation()
                guard ArchivePath.isValidSha(e.sha256) else { res.failed += 1; blocked = true; continue }
                let dest = ArchivePath.build(root: root, takenAtMs: e.takenAt, sha256: e.sha256, ext: e.ext)
                if fm.fileExists(atPath: dest.path) {
                    res.skipped += 1
                } else {
                    do {
                        let tmp = try await api.downloadOriginal(id: e.id)
                        defer { try? fm.removeItem(at: tmp) }
                        guard try Hasher256.file(tmp) == e.sha256 else { throw CocoaError(.fileReadCorruptFile) }
                        try fm.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
                        try fm.createDirectory(at: tmpDir, withIntermediateDirectories: true)
                        let part = tmpDir.appendingPathComponent("\(e.sha256).part")
                        try? fm.removeItem(at: part)
                        try fm.copyItem(at: tmp, to: part)
                        try fm.moveItem(at: part, to: dest)      // rename on one volume: atomic
                        res.copied += 1
                    } catch {
                        res.failed += 1; blocked = true
                        continue
                    }
                }
                res.lastId = e.id
                acked.append(e.id)
                if !blocked { after = e.id; store.setMeta(cursorKey(root), String(after)) }
                onProgress(res.copied + res.skipped)
            }
            await api.exportAck(ids: acked)
            if blocked { break }
        }
        try? fm.removeItem(at: tmpDir)
        return res
    }
}
