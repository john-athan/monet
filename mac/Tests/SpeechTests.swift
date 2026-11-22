import Foundation

func runSpeechTests() {
    Check.suite("speech pending") {
        let json = #"[{"ref":"item","id":7,"durationMs":45000,"ext":"MOV"},{"ref":"doc","id":3,"durationMs":1000,"ext":"m4a"},{"ref":"x","id":1},{"ref":"doc"},{"ref":"doc","id":9,"ext":"../a"}]"#
        let p = SpeechWire.parsePending(Data(json.utf8))
        Check.equal(p.count, 3, "unknown ref and missing id dropped")
        Check.equal(p[0], SpeechPending(ref: "item", id: 7, durationMs: 45000, ext: "mov"), "item parsed, ext lowercased")
        Check.equal(p[1].ref, "doc", "doc kept")
        Check.equal(p[2].ext, "a", "ext cannot carry a path")
        Check.equal(SpeechWire.parsePending(Data("[]".utf8)).count, 0, "empty array")
        Check.equal(SpeechWire.parsePending(Data("nope".utf8)).count, 0, "garbage is empty")
        Check.equal(SpeechWire.parsePending(Data(#"[{"ref":"doc","id":1}]"#.utf8))[0].ext, "m4a", "default ext")
    }
    Check.suite("speech segments and body") {
        let segs = SpeechWire.segments([(1.2, 3.4, "  Hallo zusammen \n"), (4, 5, "   "), (6.0004, 5.0, "Rück")])
        Check.equal(segs.count, 2, "empty dropped")
        Check.equal(segs[0]["s"] as? Int, 1200, "start ms")
        Check.equal(segs[0]["e"] as? Int, 3400, "end ms")
        Check.equal(segs[0]["t"] as? String, "Hallo zusammen", "trimmed")
        Check.equal(segs[1]["e"] as? Int, 6000, "end never before start")
        let body = SpeechWire.resultBody(segments: segs)
        Check.equal(body["model"] as? String, "apple-speech", "model")
        Check.equal(body["lang"] as? String, "de-DE", "lang")
        Check.equal((body["segments"] as? [[String: Any]])?.count, 2, "segments in body")
        Check.equal((SpeechWire.resultBody(segments: [])["segments"] as? [Any])?.count, 0, "no speech is an empty array")
        Check.equal(SpeechWire.failedBody["failed"] as? Bool, true, "failed body")
        Check.that(SpeechWire.failedBody["segments"] == nil, "failed body has no segments")
    }
}
