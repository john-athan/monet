import Foundation
import CryptoKit

enum Hasher256 {
    /// Streaming SHA-256 of a file, 1 MiB at a time, as lowercase hex.
    static func file(_ url: URL) throws -> String {
        let h = try FileHandle(forReadingFrom: url)
        defer { try? h.close() }
        var hasher = SHA256()
        while true {
            let more: Bool = try autoreleasepool {
                guard let d = try h.read(upToCount: 1 << 20), !d.isEmpty else { return false }
                hasher.update(data: d)
                return true
            }
            if !more { break }
        }
        return hex(hasher.finalize())
    }

    static func data(_ d: Data) -> String { hex(SHA256.hash(data: d)) }

    private static func hex(_ digest: SHA256.Digest) -> String {
        digest.map { String(format: "%02x", $0) }.joined()
    }
}
