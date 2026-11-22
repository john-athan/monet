import Foundation

func runPlannerTests() {
    Check.suite("chunk planner") {
        let mib = 1024 * 1024
        let p = ChunkPlanner.plan(total: 40 * mib)
        Check.equal(p.count, 3, "40 MiB makes three chunks")
        Check.equal(p[0].length, 16 * mib, "first chunk is 16 MiB")
        Check.equal(p[2].offset, 32 * mib, "third chunk starts at 32 MiB")
        Check.equal(p[2].length, 8 * mib, "last chunk is the remainder")
        Check.equal(ChunkPlanner.plan(total: 16 * mib).count, 1, "exactly one chunk when the size equals the chunk")
        Check.equal(ChunkPlanner.plan(total: 16 * mib + 1).count, 2, "one byte over makes two")
        Check.equal(ChunkPlanner.plan(total: 0).count, 1, "an empty file still gets one request")
        Check.equal(ChunkPlanner.length(offset: 5, total: 10, chunk: 4), 4, "length mid-file")
        Check.equal(ChunkPlanner.length(offset: 9, total: 10, chunk: 4), 1, "length at the tail")
        Check.equal(ChunkPlanner.length(offset: 12, total: 10, chunk: 4), 0, "length past the end is 0")
        Check.that(ChunkPlanner.isFinal(offset: 8, total: 10, chunk: 4), "tail chunk is final")
        Check.that(!ChunkPlanner.isFinal(offset: 4, total: 10, chunk: 4), "middle chunk is not final")
        let total = p.reduce(0) { $0 + $1.length }
        Check.equal(total, 40 * mib, "chunks add up to the file")
    }
    Check.suite("resume from 409") {
        Check.equal(ResumePlanner.afterConflict(serverOffset: 16_000_000, total: 40_000_000, restartsSoFar: 0),
                    .next(offset: 16_000_000), "continue where the server says")
        Check.equal(ResumePlanner.afterConflict(serverOffset: 0, total: 10, restartsSoFar: 0), .next(offset: 0), "server has nothing: from the start")
        Check.equal(ResumePlanner.afterConflict(serverOffset: nil, total: 10, restartsSoFar: 0), .restart, "no number: restart once")
        Check.equal(ResumePlanner.afterConflict(serverOffset: nil, total: 10, restartsSoFar: 1), .fail, "no number twice: fail")
        Check.equal(ResumePlanner.afterConflict(serverOffset: 11, total: 10, restartsSoFar: 0), .restart, "offset past the end is garbage")
        Check.equal(ResumePlanner.afterConflict(serverOffset: -1, total: 10, restartsSoFar: 0), .restart, "negative offset is garbage")
        Check.that(ResumePlanner.isStuck(tried: 5, resumed: 5, repeats: 2), "same offset again and again is stuck")
        Check.that(!ResumePlanner.isStuck(tried: 5, resumed: 8, repeats: 5), "progress is not stuck")
    }
    Check.suite("put answers") {
        func j(_ s: String) -> Data { Data(s.utf8) }
        Check.equal(try! Api.parsePut(status: 200, body: j(#"{"received":100}"#)), .received(100), "received")
        Check.equal(try! Api.parsePut(status: 200, body: j(#"{"item":{"id":7},"duplicate":true}"#)), .complete(itemId: 7, duplicate: true), "final chunk")
        Check.equal(try! Api.parsePut(status: 409, body: j(#"{"received":4096}"#)), .conflict(offset: 4096), "409 with received")
        Check.equal(try! Api.parsePut(status: 409, body: j(#"{"expected":12}"#)), .conflict(offset: 12), "409 with expected")
        Check.equal(try! Api.parsePut(status: 409, body: j("nope")), .conflict(offset: nil), "409 without a number")
        Check.throwsError("a 500 throws") { _ = try Api.parsePut(status: 500, body: j("{}")) }
    }
}
