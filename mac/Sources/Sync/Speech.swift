import Foundation
import AVFoundation
import Speech

// MARK: Pure parts (no Speech framework, testable anywhere)

/// One entry of GET /api/index/speech/pending.
struct SpeechPending: Equatable {
    let ref: String      // "item" (a video) or "doc" (an audio file)
    let id: Int
    let durationMs: Int?
    let ext: String
}

enum SpeechWire {
    static let model = "apple-speech"
    static let lang = "de-DE"

    /// Reads the pending array. Unknown refs and entries without an id are dropped, the extension is reduced to
    /// letters and digits so it is safe in a file name, and a missing one becomes "m4a".
    static func parsePending(_ data: Data) -> [SpeechPending] {
        guard let arr = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else { return [] }
        return arr.compactMap { o in
            guard let ref = o["ref"] as? String, ref == "item" || ref == "doc",
                  let id = (o["id"] as? NSNumber)?.intValue else { return nil }
            let raw = (o["ext"] as? String) ?? ""
            let ext = String(raw.lowercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) }.prefix(8))
            return SpeechPending(ref: ref, id: id, durationMs: (o["durationMs"] as? NSNumber)?.intValue,
                                 ext: ext.isEmpty ? "m4a" : ext)
        }
    }

    /// One segment per finalized result: milliseconds, trimmed text, empty ones dropped, end never before start.
    static func segments(_ raw: [(start: Double, end: Double, text: String)]) -> [[String: Any]] {
        raw.compactMap { r in
            let t = r.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !t.isEmpty, r.start.isFinite, r.end.isFinite else { return nil }
            let s = max(0, Int((r.start * 1000).rounded()))
            return ["s": s, "e": max(s, Int((r.end * 1000).rounded())), "t": t]
        }
    }

    static func resultBody(segments: [[String: Any]]) -> [String: Any] {
        ["model": model, "lang": lang, "segments": segments]
    }

    static var failedBody: [String: Any] { ["model": model, "failed": true] }
}

/// How a transcription attempt ended badly.
enum SpeechFailure: Error {
    /// The file itself cannot be transcribed (unreadable, no audio track): post `failed`, a retry will not help.
    case permanent
    /// Not the file's fault (model missing, locale unsupported): post nothing, try again later.
    case unavailable
}

// MARK: Transcription (macOS 26)

@available(macOS 26, *)
enum SpeechTranscribe {
    /// Makes sure the German model is installed (downloads it if needed) and returns the transcriber's locale.
    static func prepare() async throws -> Locale {
        guard SpeechTranscriber.isAvailable,
              let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: SpeechWire.lang)) else {
            throw SpeechFailure.unavailable
        }
        let t = makeTranscriber(locale)
        if await AssetInventory.status(forModules: [t]) < .installed {
            do {
                if let req = try await AssetInventory.assetInstallationRequest(supporting: [t]) {
                    try await req.downloadAndInstall()
                }
            } catch { throw SpeechFailure.unavailable }
            guard await AssetInventory.status(forModules: [t]) >= .installed else { throw SpeechFailure.unavailable }
        }
        return locale
    }

    private static func makeTranscriber(_ locale: Locale) -> SpeechTranscriber {
        SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: [], attributeOptions: [.audioTimeRange])
    }

    /// Transcribes an audio file; returns the segments of all finalized results.
    static func transcribe(file url: URL, locale: Locale) async throws -> [[String: Any]] {
        let audio: AVAudioFile
        do { audio = try AVAudioFile(forReading: url) } catch { throw SpeechFailure.permanent }
        let transcriber = makeTranscriber(locale)
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        let collector = Task { () -> [(start: Double, end: Double, text: String)] in
            var out: [(start: Double, end: Double, text: String)] = []
            for try await r in transcriber.results where r.isFinal {
                out.append((r.range.start.seconds, r.range.end.seconds, String(r.text.characters)))
            }
            return out
        }
        do {
            if try await analyzer.analyzeSequence(from: audio) != nil {
                try await analyzer.finalizeAndFinishThroughEndOfInput()
            } else {
                await analyzer.cancelAndFinishNow()
            }
            return SpeechWire.segments(try await collector.value)
        } catch {
            collector.cancel()
            await analyzer.cancelAndFinishNow()
            throw error
        }
    }

    /// Writes the audio track of a video (or any AV container) to a temporary m4a.
    static func extractAudio(from url: URL) async throws -> URL {
        let asset = AVURLAsset(url: url)
        let tracks = (try? await asset.loadTracks(withMediaType: .audio)) ?? []
        guard !tracks.isEmpty,
              let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
            throw SpeechFailure.permanent
        }
        let out = FileManager.default.temporaryDirectory.appendingPathComponent("monet-speech-\(UUID().uuidString).m4a")
        do { try await session.export(to: out, as: .m4a) } catch {
            try? FileManager.default.removeItem(at: out)
            throw SpeechFailure.permanent
        }
        return out
    }
}

// MARK: Worker

/// Speech for videos and audio files: GET /api/index/speech/pending, download, transcribe on the device, POST.
final class SpeechWorker: @unchecked Sendable {
    let api: Api, gate: RunGate
    private var skipped = Set<String>()
    private let lock = NSLock()

    init(api: Api, gate: RunGate) { self.api = api; self.gate = gate }

    /// One pass over what is pending. Returns how many results (including "failed" marks) were posted.
    func runOnce() async -> Int {
        guard #available(macOS 26, *) else { return 0 }
        guard let pending = try? await api.speechPending(limit: 10), !pending.isEmpty else { return 0 }
        var n = 0
        var locale: Locale?
        for p in pending {
            if Task.isCancelled { break }
            let key = "\(p.ref):\(p.id)"
            if lock.withLock({ skipped.contains(key) }) { continue }
            await gate.wait()
            do {
                if locale == nil { locale = try await SpeechTranscribe.prepare() }
                let body = try await process(p, locale: locale!)
                try await api.postSpeech(ref: p.ref, id: p.id, body: body)
                n += 1
            } catch SpeechFailure.unavailable {
                break
            } catch {
                lock.withLock { _ = skipped.insert(key) }
            }
        }
        return n
    }

    /// The body to post for one entry. Network errors while downloading throw out of here as a skip, so they
    /// are retried on the next start; everything else about the file ends as a result or a `failed` mark.
    private func process(_ p: SpeechPending, locale: Locale) async throws -> [String: Any] {
        guard #available(macOS 26, *) else { throw SpeechFailure.unavailable }
        let dl = try await (p.ref == "doc" ? api.downloadDocAudio(id: p.id) : api.downloadOriginal(id: p.id))
        let fm = FileManager.default
        let src = fm.temporaryDirectory.appendingPathComponent("monet-speech-\(UUID().uuidString).\(p.ext)")
        defer { try? fm.removeItem(at: dl); try? fm.removeItem(at: src) }
        do { try fm.moveItem(at: dl, to: src) } catch { throw SpeechFailure.unavailable }
        var extracted: URL?
        defer { if let e = extracted { try? fm.removeItem(at: e) } }
        do {
            if p.ref == "doc" {
                do { return SpeechWire.resultBody(segments: try await SpeechTranscribe.transcribe(file: src, locale: locale)) }
                catch SpeechFailure.permanent { /* container AVAudioFile cannot open: try the export route */ }
            }
            let m4a = try await SpeechTranscribe.extractAudio(from: src)
            extracted = m4a
            return SpeechWire.resultBody(segments: try await SpeechTranscribe.transcribe(file: m4a, locale: locale))
        } catch SpeechFailure.permanent {
            return SpeechWire.failedBody
        }
    }
}
