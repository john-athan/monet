import Foundation

func runIoTests() {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("monet-io-\(UUID().uuidString)")
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }

    Check.suite("sha256") {
        let f = dir.appendingPathComponent("abc.txt")
        try! Data("abc".utf8).write(to: f)
        Check.equal(try! Hasher256.file(f), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "known vector for abc")
        let big = dir.appendingPathComponent("big.bin")
        let chunk = Data(repeating: 7, count: 3 * 1024 * 1024 + 11)
        try! chunk.write(to: big)
        Check.equal(try! Hasher256.file(big), Hasher256.data(chunk), "streaming equals one-shot over several reads")
    }
    Check.suite("folder enumeration") {
        let root = dir.appendingPathComponent("pics")
        let fm = FileManager.default
        try! fm.createDirectory(at: root.appendingPathComponent("sub"), withIntermediateDirectories: true)
        try! fm.createDirectory(at: root.appendingPathComponent("Lib.photoslibrary/originals"), withIntermediateDirectories: true)
        for n in ["a.jpg", "sub/b.PNG", ".hidden.jpg", "note.txt", "Lib.photoslibrary/originals/c.jpg"] {
            try! Data("x".utf8).write(to: root.appendingPathComponent(n))
        }
        try! Data().write(to: root.appendingPathComponent("empty.jpg"))
        let found = Pipeline.enumerate(root).map { $0.url.lastPathComponent }
        Check.equal(found, ["a.jpg", "b.PNG"], "media only, no hidden, no empty, no library packages")
    }
    Check.suite("config and tokens") {
        let url = dir.appendingPathComponent("config.json")
        var c = Config(); c.folders = [FolderSource(path: "/x/Bilder")]; c.archiveLast = Date(timeIntervalSince1970: 1000)
        c.save(to: url)
        Check.equal(Config.load(from: url), c, "config round trip")
        Check.that(!Config.load(from: url).photosEnabled, "Photos is off by default")
        Check.equal(Config().serverURL, "https://monet.kaleve.dev", "default server")
        let t = FileTokenStore(url: dir.appendingPathComponent("token"))
        Check.that(t.save("secret"), "file token saved"); Check.equal(t.load(), "secret", "file token loaded")
        t.delete(); Check.isNil(t.load(), "file token deleted")
    }
}
