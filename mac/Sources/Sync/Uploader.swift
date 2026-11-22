import Foundation

/// Pause gate: workers call `wait()` between units of work.
final class RunGate: @unchecked Sendable {
    private let reasonProvider: @Sendable () -> PausePolicy.Reason?
    init(_ provider: @escaping @Sendable () -> PausePolicy.Reason?) { reasonProvider = provider }
    var reason: PausePolicy.Reason? { reasonProvider() }
    func wait() async {
        while reasonProvider() != nil, !Task.isCancelled { try? await Task.sleep(nanoseconds: 3_000_000_000) }
    }
}

struct UploadJob: Sendable {
    let sha: String
    let url: URL
    let size: Int
    let name: String
    let mtimeMs: Int64
    let source: String
    var deleteWhenDone = false
}

enum UploadEvent: Sendable {
    case queued(Int)
    case started(String)
    case finished(sha: String, ok: Bool)
}

/// PUTs files in 16 MiB chunks, two at a time, resuming from the offset a 409 reports.
final class Uploader: @unchecked Sendable {
    let api: Api
    let store: StateStore
    let gate: RunGate
    let onEvent: @Sendable (UploadEvent) -> Void
    var concurrency = 2
    var chunk = ChunkPlanner.chunkSize
    var retryDelay: UInt64 = 2_000_000_000

    init(api: Api, store: StateStore, gate: RunGate, onEvent: @escaping @Sendable (UploadEvent) -> Void) {
        self.api = api; self.store = store; self.gate = gate; self.onEvent = onEvent
    }

    @discardableResult
    func upload(_ jobs: [UploadJob]) async -> (done: Int, failed: Int) {
        onEvent(.queued(jobs.count))
        var done = 0, failed = 0
        await withTaskGroup(of: Bool.self) { group in
            var it = jobs.makeIterator()
            func add() -> Bool {
                guard let j = it.next() else { return false }
                group.addTask { [self] in await self.runOne(j) }
                return true
            }
            for _ in 0..<concurrency { if !add() { break } }
            while let ok = await group.next() {
                if ok { done += 1 } else { failed += 1 }
                _ = add()
            }
        }
        return (done, failed)
    }

    private func runOne(_ j: UploadJob) async -> Bool {
        defer { if j.deleteWhenDone { try? FileManager.default.removeItem(at: j.url) } }
        await gate.wait()
        onEvent(.started(j.name))
        do {
            let id = try await send(j)
            store.markUploaded(sha: j.sha, itemId: id)
            onEvent(.finished(sha: j.sha, ok: true))
            return true
        } catch {
            onEvent(.finished(sha: j.sha, ok: false))
            return false
        }
    }

    enum Failure: Error { case stuck, vanished }

    /// Returns the item id when the server reports one.
    func send(_ j: UploadJob) async throws -> Int? {
        let h = try FileHandle(forReadingFrom: j.url)
        defer { try? h.close() }
        var offset = 0
        var restarts = 0
        var sameResume = 0
        var lastTried = -1
        var transportFailures = 0
        while true {
            try Task.checkCancellation()
            await gate.wait()
            let len = ChunkPlanner.length(offset: offset, total: j.size, chunk: chunk)
            try h.seek(toOffset: UInt64(offset))
            let data = try h.read(upToCount: len) ?? Data()
            if data.count != len { throw Failure.vanished }   // the file shrank under us
            let result: PutResult
            do {
                result = try await api.put(sha: j.sha, offset: offset, total: j.size, name: j.name,
                                           mtimeMs: j.mtimeMs, source: j.source, chunk: data)
                transportFailures = 0
            } catch let e as ApiError where (400..<500).contains(e.status) {
                throw e
            } catch {
                transportFailures += 1
                if transportFailures > 4 { throw error }
                try await Task.sleep(nanoseconds: retryDelay << UInt64(transportFailures - 1))
                continue
            }
            switch result {
            case .complete(let id, _):
                return id
            case .received(let n):
                let sent = offset + len
                // The server's count wins when it is sane; otherwise trust what we sent.
                offset = (n > offset && n <= j.size) ? n : sent
                if offset >= j.size { throw Failure.stuck }   // no final answer although everything is sent
            case .conflict(let s):
                switch ResumePlanner.afterConflict(serverOffset: s, total: j.size, restartsSoFar: restarts) {
                case .next(let o):
                    sameResume = (o == lastTried) ? sameResume + 1 : 0
                    if ResumePlanner.isStuck(tried: offset, resumed: o, repeats: sameResume) { throw Failure.stuck }
                    lastTried = o
                    offset = o
                case .restart: restarts += 1; offset = 0
                case .fail: throw Failure.stuck
                }
            }
        }
    }
}
