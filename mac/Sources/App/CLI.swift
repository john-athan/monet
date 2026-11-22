import Foundation

/// Headless commands for tests, so the sync pipeline can be driven without the menu bar UI:
///   monet sync    --home DIR --server URL [--code CODE] --folder PATH [--folder PATH]... [--ocr-seconds N]
///   monet archive --home DIR --server URL --dir PATH
/// They keep the token in DIR/token (never in the Keychain), print one JSON line and exit.
/// Returns nil when the arguments are not a CLI invocation (the normal menu bar start).
func runCLI(_ argv: [String]) -> Int32? {
    guard let cmd = argv.first, cmd == "sync" || cmd == "archive" else { return nil }
    var opts: [String: [String]] = [:]
    var i = 1
    while i + 1 < argv.count, argv[i].hasPrefix("--") { opts[argv[i], default: []].append(argv[i + 1]); i += 2 }
    guard let home = opts["--home"]?.first, let server = opts["--server"]?.first, let base = ServerURL.normalize(server) else {
        FileHandle.standardError.write(Data("usage: monet sync|archive --home DIR --server URL ...\n".utf8)); return 2
    }
    setenv("MONET_HOME", home, 1)
    let tokens = FileTokenStore(url: URL(fileURLWithPath: home).appendingPathComponent("token"))
    let sem = DispatchSemaphore(value: 0)
    var code: Int32 = 0
    Task.detached {
        defer { sem.signal() }
        do {
            if tokens.load() == nil {
                guard let c = opts["--code"]?.first, let norm = PairingCode.normalize(c) else { throw CocoaError(.userCancelled) }
                let r = try await Api(base: base, token: nil).claim(code: norm, name: "monet-test")
                _ = tokens.save(r.token)
            }
            let api = Api(base: base, token: tokens.load())
            let store = try StateStore(path: URL(fileURLWithPath: home).appendingPathComponent("state.sqlite").path)
            let gate = RunGate { nil }
            var out: [String: Any] = [:]
            if cmd == "sync" {
                let p = Pipeline(api: api, store: store, gate: gate) { _ in }
                var tot = Pipeline.Report()
                for f in opts["--folder"] ?? [] {
                    let r = await p.syncFolder(f)
                    tot.files += r.files; tot.hashed += r.hashed; tot.uploaded += r.uploaded; tot.alreadyThere += r.alreadyThere; tot.failed += r.failed
                }
                let worker = OcrWorker(api: api, store: store, gate: gate)
                var posted = 0
                let deadline = Date().addingTimeInterval(Double(opts["--ocr-seconds"]?.first ?? "60") ?? 60)
                var idle = 0
                while Date() < deadline && idle < 3 {
                    let n = await worker.runOnce()
                    posted += n
                    if n == 0 { idle += 1; try? await Task.sleep(nanoseconds: 1_000_000_000) } else { idle = 0 }
                }
                out = ["files": tot.files, "hashed": tot.hashed, "uploaded": tot.uploaded, "alreadyThere": tot.alreadyThere,
                       "failed": tot.failed, "ocrPosted": posted]
            } else {
                guard let dir = opts["--dir"]?.first else { throw CocoaError(.userCancelled) }
                let r = try await ArchiveCopier.run(api: api, store: store, root: URL(fileURLWithPath: dir), gate: gate)
                out = ["copied": r.copied, "skipped": r.skipped, "failed": r.failed]
            }
            let d = try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])
            print(String(data: d, encoding: .utf8)!)
        } catch {
            FileHandle.standardError.write(Data("error: \(error)\n".utf8)); code = 1
        }
    }
    sem.wait()
    return code
}
