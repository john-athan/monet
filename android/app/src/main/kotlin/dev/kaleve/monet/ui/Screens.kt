package dev.kaleve.monet.ui

import android.graphics.Bitmap
import android.text.format.Formatter
import android.util.Size
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.text.BasicText
import dev.kaleve.monet.R
import dev.kaleve.device.isCompleteCode
import dev.kaleve.monet.core.*
import dev.kaleve.monet.core.Unit as AgoUnit
import dev.kaleve.monet.data.Media
import dev.kaleve.monet.work.BackupState
import kotlinx.coroutines.launch
import java.text.NumberFormat
import java.util.Locale

private val de = Locale.GERMANY
private fun num(n: Int): String = NumberFormat.getIntegerInstance(de).format(n)

/** Small counts are written out like the design does ("zwölf"); larger ones are digits. */
@Composable
private fun word(n: Int): String {
    val words = stringArrayResource(R.array.zahlwoerter)
    return if (n in 1..12) words[n - 1] else num(n)
}
@Composable private fun stringArrayResource(id: Int): Array<String> = LocalContext.current.resources.getStringArray(id)
@Composable private fun cap(s: String) = s.replaceFirstChar { it.uppercase(de) }

@Composable
private fun kinds(photos: Int, videos: Int): String = when {
    photos > 0 && videos > 0 -> stringResource(R.string.n_fotos_videos, num(photos + videos))
    videos > 0 -> pluralStringResource(R.plurals.n_videos, videos, num(videos))
    else -> pluralStringResource(R.plurals.n_fotos, photos, num(photos))
}

@Composable
fun Root(model: Model, p: Palette, requestPermissions: () -> kotlin.Unit, onFree: (Model) -> kotlin.Unit) {
    CompositionLocalProvider(LocalStyle provides model.style) {
        Column(Modifier.fillMaxSize().background(p.ground).systemBarsPadding()) {
            if (model.paired) StatusScreen(model, p, requestPermissions, onFree) else PairScreen(model, p)
        }
    }
}

@Composable
private fun Header(p: Palette, right: String?) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 18.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        val style = LocalStyle.current
        Image(painterResource(style.mark), stringResource(R.string.mark_desc, style.brand), Modifier.size(34.dp))
        Txt(style.brand, p, 26f, display = true, lineHeight = 1f)
        Spacer(Modifier.weight(1f))
        if (right != null) Txt(right, p, 13f, p.muted)
    }
}

@Composable
fun ColumnScope.PairScreen(model: Model, p: Palette) {
    val scope = rememberCoroutineScope()
    var server by remember { mutableStateOf(model.settings.server) }
    var code by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<PairError?>(null) }
    Header(p, null)
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(top = 22.dp, bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Column(Modifier.padding(horizontal = 4.dp, vertical = 0.dp).padding(top = 0.dp, bottom = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            DabTitle(stringResource(R.string.pair_title), p)
            Txt(stringResource(R.string.pair_hint), p, 15f, p.muted)
        }
        Field(server, stringResource(R.string.pair_server), p, { server = it }, KeyboardOptions(keyboardType = KeyboardType.Uri))
        Field(code, stringResource(R.string.pair_code), p, { code = it.filter { c -> c.isLetterOrDigit() && c.code < 128 }.take(8); error = null },
            KeyboardOptions(keyboardType = KeyboardType.Ascii), tabular = true, visual = CodeDash)
        error?.let {
            Txt(stringResource(when (it) {
                PairError.Code -> R.string.pair_err_code; PairError.Server -> R.string.pair_err_server
                PairError.Network -> R.string.pair_err_network; PairError.Rate -> R.string.pair_err_rate
            }), p, 14f, p.sun)
        }
        Spacer(Modifier.weight(1f))
        PillButton(stringResource(if (busy) R.string.pair_busy else R.string.pair_go), p, enabled = isCompleteCode(code) && !busy) {
            busy = true; error = null
            scope.launch { error = model.pair(server, code); busy = false }
        }
    }
}

@Composable
fun ColumnScope.StatusScreen(model: Model, p: Palette, requestPermissions: () -> kotlin.Unit, onFree: (Model) -> kotlin.Unit) {
    val ctx = LocalContext.current
    val s = model.status
    val progress by BackupState.running.collectAsState()
    val now by produceState(System.currentTimeMillis(), model.lastBackupAt, progress) {
        while (true) { value = System.currentTimeMillis(); kotlinx.coroutines.delay(20_000) }
    }
    val running = progress

    Header(p, when (model.connected) {
        true -> stringResource(R.string.verbunden); false -> stringResource(R.string.nicht_erreichbar); null -> null
    })
    Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(top = 14.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        // Title and the last-backup line
        Column(Modifier.padding(start = 4.dp, end = 4.dp, top = 22.dp, bottom = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            DabTitle(when {
                running != null -> stringResource(R.string.sichert_von_titel, num(running.done), num(running.total))
                s.pending > 0 -> pluralStringResource(R.plurals.noch_offen, s.pending, num(s.pending))
                else -> stringResource(R.string.alles_gesichert)
            }, p)
            Txt(subtitle(model.lastBackupAt, now, s), p, 15f, p.muted)
            Txt(stringResource(R.string.fotos_ansehen), p, 15f, p.water, FontWeight.SemiBold,
                modifier = Modifier.padding(top = 4.dp).clickable(role = Role.Button) { dev.kaleve.monet.BrowseActivity.start(ctx) })
        }

        if (!model.hasAccess || model.partial) {
            Card(p) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Txt(stringResource(if (model.partial) R.string.zugriff_teil_titel else R.string.zugriff_titel), p, weight = FontWeight.SemiBold)
                    Txt(stringResource(if (model.partial) R.string.zugriff_teil_text else R.string.zugriff_text), p, 14f, p.muted)
                    Txt(stringResource(when {
                        model.blocked -> R.string.zugriff_einstellungen
                        model.partial -> R.string.zugriff_alle
                        else -> R.string.zugriff_knopf
                    }), p, 14f, p.water, FontWeight.SemiBold, modifier = Modifier.clickable(role = Role.Button) { requestPermissions() })
                }
            }
        }

        if (s.pending > 0) QueueCard(model, p, s, running != null)

        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Txt(stringResource(R.string.ordner_titel), p, 22f, display = true, lineHeight = 1.2f, modifier = Modifier.padding(start = 4.dp, end = 4.dp, top = 6.dp))
            Card(p) {
                s.folders.forEachIndexed { i, f ->
                    val label = if (f.name == "Camera") stringResource(R.string.kamera) else f.name
                    val count = if (f.on) kinds(f.photos, f.videos)
                    else (if (f.videos == 0) pluralStringResource(R.plurals.n_bilder, f.photos, num(f.photos)) else kinds(f.photos, f.videos)) + stringResource(R.string.nicht_gesichert)
                    SwitchRow(label, count, f.on, p, i == 0) { model.setFolder(f, it) }
                }
                if (s.folders.isEmpty()) Box(Modifier.padding(16.dp)) { Txt(stringResource(R.string.keine_ordner), p, 14f, p.muted) }
            }
        }

        Card(p) {
            SwitchRow(stringResource(R.string.nur_wlan), null, model.wifiOnly, p, true) { model.setWifi(it) }
            SwitchRow(stringResource(R.string.nur_laden), null, model.chargingOnly, p, false) { model.setCharging(it) }
        }
        Spacer(Modifier.height(2.dp))
    }

    // Platz freigeben, pinned to the bottom like in the design
    Card(p, Modifier.padding(horizontal = 16.dp).padding(top = 10.dp, bottom = 20.dp), fill = p.waterSoft, bordered = false) {
      Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        val msg = model.message
        if (msg != null) Txt(stringResource(msg), p, 15f, lineHeight = 1.4f)
        else if (s.freeCount > 0) {
            val bold = kinds(s.freePhotos, s.freeVideos)
            val full = pluralStringResource(R.plurals.frei_text, s.freeCount, bold, Formatter.formatFileSize(ctx, s.freeBytes))
            val at = full.indexOf(bold)
            Text2(buildAnnotatedString {
                if (at >= 0) { append(full.substring(0, at)); withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(bold) }; append(full.substring(at + bold.length)) } else append(full)
            }, p)
        } else Txt(stringResource(R.string.frei_leer), p, 15f, lineHeight = 1.4f)
        PillButton(stringResource(R.string.platz_freigeben), p, enabled = s.freeCount > 0 && !model.freeing) { model.message = null; onFree(model) }
      }
    }
}

@Composable
private fun Text2(text: AnnotatedString, p: Palette) =
    BasicText(text, style = TextStyle(color = p.ink, fontSize = 15.sp, lineHeight = 21.sp))

@Composable
private fun subtitle(last: Long, now: Long, s: Status): String {
    val a = ago(last, now)
    val head = when (a.unit) {
        AgoUnit.Never -> return stringResource(R.string.noch_nie)
        AgoUnit.Now -> stringResource(R.string.zuletzt_jetzt)
        AgoUnit.Minutes -> pluralStringResource(R.plurals.zuletzt_min, a.n, word(a.n))
        AgoUnit.Hours -> pluralStringResource(R.plurals.zuletzt_std, a.n, word(a.n))
        AgoUnit.Days -> pluralStringResource(R.plurals.zuletzt_tage, a.n, word(a.n))
    }
    val fotos = if (s.todayPhotos > 0) pluralStringResource(R.plurals.heute_fotos, s.todayPhotos, word(s.todayPhotos)) else null
    val videos = if (s.todayVideos > 0) pluralStringResource(R.plurals.heute_videos, s.todayVideos, word(s.todayVideos)) else null
    val today = when {
        fotos != null && videos != null -> stringResource(R.string.heute_beides, fotos, videos)
        fotos != null -> stringResource(R.string.heute_eins, fotos)
        videos != null -> stringResource(R.string.heute_eins, videos)
        else -> stringResource(R.string.heute_nichts)
    }
    return "$head $today"
}

@Composable
private fun QueueCard(model: Model, p: Palette, s: Status, running: Boolean) {
    val ctx = LocalContext.current
    Card(p) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy((-10).dp)) {
                s.waiting.forEach { l -> Thumb(l, p, Modifier) }
            }
            Column(Modifier.weight(1f)) {
                val n = word(s.pending)
                Txt(when {
                    running -> stringResource(R.string.queue_laeuft)
                    model.wifiOnly && !s.unmetered -> pluralStringResource(R.plurals.warten_wlan, s.pending, cap(n))
                    model.chargingOnly && !s.charging -> pluralStringResource(R.plurals.warten_strom, s.pending, cap(n))
                    else -> pluralStringResource(R.plurals.warten_sonst, s.pending, cap(n))
                }, p, weight = FontWeight.SemiBold, lineHeight = 1.3f)
                if (model.wifiOnly || model.chargingOnly) {
                    Txt(stringResource(R.string.jetzt_mobil), p, 14f, p.water, FontWeight.SemiBold, lineHeight = 1.3f,
                        modifier = Modifier.clickable(role = Role.Button) { dev.kaleve.monet.work.Scheduler.sendOverMobile(ctx) })
                }
            }
        }
    }
}

@Composable
private fun Thumb(l: Local, p: Palette, modifier: Modifier) {
    val ctx = LocalContext.current
    var bmp by remember(l.id) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(l.id) {
        bmp = withContextIO { try { ctx.contentResolver.loadThumbnail(Media.uriOf(l), Size(120, 120), null) } catch (_: Exception) { null } }
    }
    Box(modifier.size(40.dp).clip(RoundedCornerShape(8.dp)).background(p.surface3).border(2.dp, p.surface, RoundedCornerShape(8.dp))) {
        bmp?.let { Image(it.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = androidx.compose.ui.layout.ContentScale.Crop) }
    }
}

private suspend fun <T> withContextIO(block: () -> T): T = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { block() }
