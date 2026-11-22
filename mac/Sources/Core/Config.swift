import Foundation

enum Paths {
    /// Application Support/Monet, or $MONET_HOME (tests).
    static var home: URL {
        if let h = ProcessInfo.processInfo.environment["MONET_HOME"], !h.isEmpty { return URL(fileURLWithPath: h) }
        return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Monet", isDirectory: true)
    }
}

struct FolderSource: Codable, Equatable, Identifiable {
    var path: String
    var enabled: Bool = true
    var id: String { path }
    var name: String { (path as NSString).lastPathComponent }
}

/// Plain settings. Nothing secret: the token is in the Keychain.
struct Config: Codable, Equatable {
    var serverURL: String = "https://monet.kaleve.dev"
    var deviceId: String?
    var folders: [FolderSource] = []
    var photosEnabled = false
    var paused = false
    var archivePath: String?
    var archiveLast: Date?
    /// The owner's style as the server last said it, so the panel wears it from the first frame.
    var theme: String?

    static func load(from url: URL) -> Config {
        guard let d = try? Data(contentsOf: url) else { return Config() }
        let dec = JSONDecoder(); dec.dateDecodingStrategy = .iso8601
        return (try? dec.decode(Config.self, from: d)) ?? Config()
    }

    func save(to url: URL) {
        let enc = JSONEncoder(); enc.dateEncodingStrategy = .iso8601; enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let d = try? enc.encode(self) else { return }
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? d.write(to: url, options: .atomic)
    }
}
