package dev.kaleve.monet

import android.Manifest
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import dev.kaleve.monet.core.Light
import dev.kaleve.monet.core.lightFor
import dev.kaleve.monet.ui.Model
import dev.kaleve.monet.ui.Root
import dev.kaleve.monet.work.BackupState
import dev.kaleve.monet.work.Scheduler
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Calendar

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val model = Model(applicationContext)
        // Debug builds only: `--es light mittag` pins the light for screenshots.
        val forced = if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0)
            intent.getStringExtra("light")?.let { n -> Light.entries.firstOrNull { it.name.equals(n, true) } } else null

        setContent {
            val scope = rememberCoroutineScope()
            val dark = isSystemInDarkTheme()
            var hour by remember { mutableIntStateOf(Calendar.getInstance().get(Calendar.HOUR_OF_DAY)) }
            LaunchedEffect(Unit) {
                while (true) {
                    val now = System.currentTimeMillis()
                    delay(60_000 - now % 60_000)
                    hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
                }
            }
            val p = model.style.palette(forced ?: lightFor(hour, dark))
            val view = LocalView.current
            SideEffect { WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !p.dark; WindowCompat.getInsetsController(window, view).isAppearanceLightNavigationBars = !p.dark }

            val progress by BackupState.running.collectAsState()
            val unauthorized by BackupState.unauthorized.collectAsState()
            if (unauthorized) model.paired = false

            val perms = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
                scope.launch {
                    model.refresh()
                    // Denied and no rationale any more: Android will not show the dialog again.
                    if (!model.hasAccess && !shouldShowRequestPermissionRationale(Manifest.permission.READ_MEDIA_IMAGES)) model.blocked = true
                    if (model.hasAccess && model.paired) Scheduler.kick(applicationContext)
                }
            }
            val askPerms = {
                if (model.blocked) startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
                else perms.launch(arrayOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO,
                    Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED,
                    Manifest.permission.ACCESS_MEDIA_LOCATION, Manifest.permission.POST_NOTIFICATIONS))
            }

            var freeIds by remember { mutableStateOf<List<Long>>(emptyList()) }
            val deleter = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { r ->
                model.freeing = false
                if (r.resultCode == RESULT_OK) scope.launch { model.finishFree(freeIds) }
            }

            LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { scope.launch { model.refresh(); model.checkServer() } }
            LaunchedEffect(model.paired, model.hasAccess) { if (model.paired && !model.hasAccess) askPerms() }
            // The numbers move while a run is going and once more when it ends.
            LaunchedEffect(progress == null, progress?.done?.div(10)) { model.refresh() }

            Root(model, p, askPerms) { m ->
                m.freeing = true
                scope.launch {
                    val req = m.prepareFree()
                    if (req == null) { m.freeing = false } else {
                        freeIds = req.ids
                        deleter.launch(IntentSenderRequest.Builder(req.request.intentSender).build())
                    }
                }
            }
        }
    }
}
