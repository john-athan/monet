import Foundation
import Vision

enum Ocr {
    static func makeRequest() -> VNRecognizeTextRequest {
        let r = VNRecognizeTextRequest()
        r.recognitionLevel = .accurate
        r.recognitionLanguages = ["de-DE", "en-US"]
        r.usesLanguageCorrection = true
        return r
    }

    private static func text(_ r: VNRecognizeTextRequest) -> String {
        let lines = (r.results ?? []).compactMap { $0.topCandidates(1).first?.string }
        return String(lines.joined(separator: "\n").prefix(100_000))
    }

    static func recognize(url: URL) throws -> String {
        let req = makeRequest()
        try VNImageRequestHandler(url: url).perform([req])
        return text(req)
    }

    static func recognize(data: Data) throws -> String {
        let req = makeRequest()
        try VNImageRequestHandler(data: data).perform([req])
        return text(req)
    }
}
