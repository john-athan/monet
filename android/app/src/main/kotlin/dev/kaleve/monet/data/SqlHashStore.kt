package dev.kaleve.monet.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import dev.kaleve.monet.core.HashStore
import dev.kaleve.monet.core.Seen

/** A tiny SQLite table: MediaStore id + size + date_modified -> sha256. */
class SqlHashStore(context: Context) : HashStore {
    private val helper = object : SQLiteOpenHelper(context, "hashes.db", null, 1) {
        override fun onCreate(db: SQLiteDatabase) {
            db.execSQL("CREATE TABLE seen(id INTEGER PRIMARY KEY, size INTEGER NOT NULL, modified INTEGER NOT NULL, " +
                "sha TEXT NOT NULL, on_server INTEGER NOT NULL DEFAULT 0, uploaded_at INTEGER NOT NULL DEFAULT 0, video INTEGER NOT NULL DEFAULT 0)")
        }
        override fun onUpgrade(db: SQLiteDatabase, o: Int, n: Int) {}
    }

    private fun read(c: android.database.Cursor) = Seen(
        c.getLong(0), c.getLong(1), c.getLong(2), c.getString(3), c.getInt(4) == 1, c.getLong(5), c.getInt(6) == 1,
    )
    private val cols = arrayOf("id", "size", "modified", "sha", "on_server", "uploaded_at", "video")

    @Synchronized override fun get(id: Long, size: Long, modified: Long): Seen? =
        helper.readableDatabase.query("seen", cols, "id=? AND size=? AND modified=?", arrayOf("$id", "$size", "$modified"), null, null, null)
            .use { if (it.moveToFirst()) read(it) else null }

    @Synchronized override fun put(seen: Seen) {
        val v = ContentValues().apply {
            put("id", seen.id); put("size", seen.size); put("modified", seen.modified); put("sha", seen.sha256)
            put("on_server", if (seen.onServer) 1 else 0); put("uploaded_at", seen.uploadedAt); put("video", if (seen.video) 1 else 0)
        }
        helper.writableDatabase.insertWithOnConflict("seen", null, v, SQLiteDatabase.CONFLICT_REPLACE)
    }

    @Synchronized override fun markOnServer(id: Long, atMillis: Long) {
        helper.writableDatabase.execSQL(
            "UPDATE seen SET on_server=1, uploaded_at=CASE WHEN uploaded_at=0 THEN ? ELSE uploaded_at END WHERE id=?", arrayOf(atMillis, id))
    }

    @Synchronized override fun all(): List<Seen> =
        helper.readableDatabase.query("seen", cols, null, null, null, null, null).use { c ->
            buildList { while (c.moveToNext()) add(read(c)) }
        }

    @Synchronized override fun remove(ids: Collection<Long>) {
        val db = helper.writableDatabase
        db.beginTransaction()
        try { ids.forEach { db.delete("seen", "id=?", arrayOf("$it")) }; db.setTransactionSuccessful() } finally { db.endTransaction() }
    }
}
