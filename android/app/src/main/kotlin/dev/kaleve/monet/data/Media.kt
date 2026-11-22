package dev.kaleve.monet.data

import android.content.ContentResolver
import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import dev.kaleve.monet.core.Local

object Media {
    private val files = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL)

    fun uriOf(l: Local): Uri = uriOf(l.id, l.video)
    fun uriOf(id: Long, video: Boolean): Uri = ContentUris.withAppendedId(
        if (video) MediaStore.Video.Media.EXTERNAL_CONTENT_URI else MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id)

    /** Images get the unredacted original so GPS stays in the uploaded bytes. */
    fun originalOf(l: Local): Uri = uriOf(l).let { if (l.video) it else MediaStore.setRequireOriginal(it) }

    /** Every photo and video the app may see. Cheap: one query, no file access. */
    fun scan(cr: ContentResolver): List<Local> {
        val proj = arrayOf(
            MediaStore.Files.FileColumns._ID, MediaStore.Files.FileColumns.SIZE, MediaStore.Files.FileColumns.DATE_MODIFIED,
            MediaStore.Files.FileColumns.MEDIA_TYPE, MediaStore.Files.FileColumns.BUCKET_ID,
            MediaStore.Files.FileColumns.BUCKET_DISPLAY_NAME, MediaStore.Files.FileColumns.DISPLAY_NAME,
            MediaStore.Files.FileColumns.DATE_TAKEN,
        )
        val sel = "${MediaStore.Files.FileColumns.MEDIA_TYPE} IN (?, ?) AND ${MediaStore.Files.FileColumns.SIZE} > 0"
        val args = arrayOf(MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE.toString(), MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO.toString())
        val out = ArrayList<Local>()
        try {
            cr.query(files, proj, sel, args, "${MediaStore.Files.FileColumns.DATE_ADDED} DESC")?.use { c ->
                while (c.moveToNext()) {
                    out += Local(
                        id = c.getLong(0), size = c.getLong(1), modified = c.getLong(2),
                        video = c.getInt(3) == MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO,
                        bucketId = c.getLong(4), bucket = c.getString(5) ?: "", name = c.getString(6) ?: "",
                        takenMs = c.getLong(7),
                    )
                }
            }
        } catch (_: SecurityException) { /* permission not granted yet */ }
        return out
    }

    private fun granted(context: Context, perm: String) =
        context.checkSelfPermission(perm) == android.content.pm.PackageManager.PERMISSION_GRANTED

    /** All photos or all videos. */
    fun hasFullAccess(context: Context): Boolean =
        granted(context, android.Manifest.permission.READ_MEDIA_IMAGES) || granted(context, android.Manifest.permission.READ_MEDIA_VIDEO)

    /** Full access, or (Android 14+) only the photos the user picked: MediaStore then shows just those. */
    fun hasAccess(context: Context): Boolean =
        hasFullAccess(context) || granted(context, android.Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)
}
