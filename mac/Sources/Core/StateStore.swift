import Foundation
import SQLite3

/// Remembers the sha256 of every path or Photos asset so nothing is hashed twice, which
/// items the server has, and the archive cursor. One SQLite file, the system C API.
final class StateStore: @unchecked Sendable {
    struct Entry: Equatable {
        var key: String; var source: String; var size: Int64; var mtime: Double
        var sha: String; var uploaded: Bool; var itemId: Int?
    }

    private var db: OpaquePointer?
    private let lock = NSLock()
    private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    /// `path` may be ":memory:".
    init(path: String) throws {
        if path != ":memory:" {
            try FileManager.default.createDirectory(at: URL(fileURLWithPath: path).deletingLastPathComponent(),
                                                    withIntermediateDirectories: true)
        }
        guard sqlite3_open(path, &db) == SQLITE_OK else { throw StoreError.open }
        try exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")
        try exec("""
        CREATE TABLE IF NOT EXISTS file(key TEXT PRIMARY KEY, source TEXT NOT NULL, size INTEGER NOT NULL,
          mtime REAL NOT NULL, sha TEXT NOT NULL, uploaded INTEGER NOT NULL DEFAULT 0, item_id INTEGER);
        CREATE INDEX IF NOT EXISTS file_sha ON file(sha);
        CREATE INDEX IF NOT EXISTS file_item ON file(item_id);
        CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);
        """)
    }
    deinit { sqlite3_close(db) }

    enum StoreError: Error { case open, sql(String) }

    private func exec(_ sql: String) throws {
        var err: UnsafeMutablePointer<CChar>?
        if sqlite3_exec(db, sql, nil, nil, &err) != SQLITE_OK {
            let m = err.map { String(cString: $0) } ?? "sqlite"
            sqlite3_free(err); throw StoreError.sql(m)
        }
    }

    /// Runs one statement with bound values; `row` is called per result row.
    private func run(_ sql: String, _ args: [Any?], row: ((OpaquePointer) -> Void)? = nil) {
        lock.lock(); defer { lock.unlock() }
        var st: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &st, nil) == SQLITE_OK, let s = st else { return }
        defer { sqlite3_finalize(s) }
        for (i, a) in args.enumerated() {
            let n = Int32(i + 1)
            switch a {
            case let v as String: sqlite3_bind_text(s, n, v, -1, SQLITE_TRANSIENT)
            case let v as Int: sqlite3_bind_int64(s, n, Int64(v))
            case let v as Int64: sqlite3_bind_int64(s, n, v)
            case let v as Double: sqlite3_bind_double(s, n, v)
            case let v as Bool: sqlite3_bind_int(s, n, v ? 1 : 0)
            default: sqlite3_bind_null(s, n)
            }
        }
        while sqlite3_step(s) == SQLITE_ROW { row?(s) }
    }

    private func entry(_ s: OpaquePointer) -> Entry {
        Entry(key: String(cString: sqlite3_column_text(s, 0)), source: String(cString: sqlite3_column_text(s, 1)),
              size: sqlite3_column_int64(s, 2), mtime: sqlite3_column_double(s, 3),
              sha: String(cString: sqlite3_column_text(s, 4)), uploaded: sqlite3_column_int(s, 5) != 0,
              itemId: sqlite3_column_type(s, 6) == SQLITE_NULL ? nil : Int(sqlite3_column_int64(s, 6)))
    }
    private let cols = "key, source, size, mtime, sha, uploaded, item_id"

    /// The known entry for a key, only if size and mtime still match (otherwise the file changed).
    func lookup(key: String, size: Int64, mtime: Double) -> Entry? {
        var out: Entry?
        run("SELECT \(cols) FROM file WHERE key=?1 AND size=?2 AND mtime=?3", [key, size, mtime]) { out = self.entry($0) }
        return out
    }

    /// Lookup by key alone (Photos assets: an original does not change).
    func lookup(key: String) -> Entry? {
        var out: Entry?
        run("SELECT \(cols) FROM file WHERE key=?1", [key]) { out = self.entry($0) }
        return out
    }

    func put(key: String, source: String, size: Int64, mtime: Double, sha: String) {
        run("""
        INSERT INTO file(key, source, size, mtime, sha) VALUES(?1,?2,?3,?4,?5)
        ON CONFLICT(key) DO UPDATE SET source=?2, size=?3, mtime=?4, sha=?5,
          uploaded=CASE WHEN sha=?5 THEN uploaded ELSE 0 END,
          item_id=CASE WHEN sha=?5 THEN item_id ELSE NULL END
        """, [key, source, size, mtime, sha])
    }

    /// Marks every entry with this hash as present on the server.
    func markUploaded(sha: String, itemId: Int?) {
        run("UPDATE file SET uploaded=1, item_id=COALESCE(?2, item_id) WHERE sha=?1", [sha, itemId])
    }

    func entries(forItem id: Int) -> [Entry] {
        var out: [Entry] = []
        run("SELECT \(cols) FROM file WHERE item_id=?1", [id]) { out.append(self.entry($0)) }
        return out
    }

    func remove(source: String) { run("DELETE FROM file WHERE source=?1", [source]) }
    func remove(key: String) { run("DELETE FROM file WHERE key=?1", [key]) }
    func removeAllFiles() { run("DELETE FROM file", []); run("DELETE FROM meta", []) }

    /// (known files, uploaded files) of one source.
    func counts(source: String) -> (total: Int, uploaded: Int) {
        var t = 0, u = 0
        run("SELECT COUNT(*), COALESCE(SUM(uploaded),0) FROM file WHERE source=?1", [source]) {
            t = Int(sqlite3_column_int64($0, 0)); u = Int(sqlite3_column_int64($0, 1))
        }
        return (t, u)
    }

    func meta(_ k: String) -> String? {
        var out: String?
        run("SELECT v FROM meta WHERE k=?1", [k]) { out = String(cString: sqlite3_column_text($0, 0)) }
        return out
    }
    func setMeta(_ k: String, _ v: String) {
        run("INSERT INTO meta(k,v) VALUES(?1,?2) ON CONFLICT(k) DO UPDATE SET v=?2", [k, v])
    }
}

extension StateStore {
    /// Forget everything (after unpairing: the server's idea of what it holds no longer applies).
    func reset() {
        remove(source: "photos")
        removeAllFiles()
    }
}
