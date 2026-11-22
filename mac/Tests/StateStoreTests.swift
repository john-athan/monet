import Foundation

func runStateStoreTests() {
    Check.suite("state store") {
        let s = try! StateStore(path: ":memory:")
        Check.isNil(s.lookup(key: "f:/a", size: 1, mtime: 1), "unknown file")
        s.put(key: "f:/a", source: "folder:/", size: 10, mtime: 5, sha: "aa")
        let e = s.lookup(key: "f:/a", size: 10, mtime: 5)
        Check.equal(e?.sha, "aa", "remembers the hash for the same size and mtime")
        Check.that(e?.uploaded == false, "not uploaded yet")
        Check.isNil(s.lookup(key: "f:/a", size: 11, mtime: 5), "a changed size forgets the hash")
        Check.isNil(s.lookup(key: "f:/a", size: 10, mtime: 6), "a changed mtime forgets the hash")
        s.put(key: "f:/b", source: "folder:/", size: 3, mtime: 5, sha: "aa")
        s.markUploaded(sha: "aa", itemId: 42)
        Check.that(s.lookup(key: "f:/a")?.uploaded == true, "marking by hash covers every path with it")
        Check.that(s.lookup(key: "f:/b")?.uploaded == true, "second path too")
        Check.equal(s.entries(forItem: 42).count, 2, "item id maps back to both paths")
        s.put(key: "f:/a", source: "folder:/", size: 10, mtime: 5, sha: "aa")
        Check.that(s.lookup(key: "f:/a")?.uploaded == true, "same hash keeps the uploaded flag")
        s.put(key: "f:/a", source: "folder:/", size: 12, mtime: 9, sha: "bb")
        Check.that(s.lookup(key: "f:/a")?.uploaded == false, "new content resets the flag")
        Check.isNil(s.lookup(key: "f:/a")?.itemId, "and the item id")
        let c = s.counts(source: "folder:/")
        Check.equal(c.total, 2, "counts total"); Check.equal(c.uploaded, 1, "counts uploaded")
        s.setMeta("k", "1"); s.setMeta("k", "2")
        Check.equal(s.meta("k"), "2", "meta overwrites")
        s.remove(source: "folder:/")
        Check.equal(s.counts(source: "folder:/").total, 0, "removing a source forgets its files")
    }
    Check.suite("state store on disk") {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("monet-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let path = dir.appendingPathComponent("state.sqlite").path
        do {
            let s = try! StateStore(path: path)
            s.put(key: "p:XYZ", source: "photos", size: 1, mtime: 2, sha: "cc")
        }
        let again = try! StateStore(path: path)
        Check.equal(again.lookup(key: "p:XYZ")?.sha, "cc", "survives a restart")
    }
}
