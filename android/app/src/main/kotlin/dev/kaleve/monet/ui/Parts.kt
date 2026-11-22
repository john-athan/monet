package dev.kaleve.monet.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.selection.toggleable
import androidx.compose.runtime.*
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.text.BasicText

// No font files in the app: FontFamily.Serif stands in for Didot, so titles look
// plainer than in the design.
val Display = FontFamily.Serif

/** The style of the paired library; provided once in Root so no composable needs it passed down. */
val LocalStyle = staticCompositionLocalOf { Styles.monet }

/** Rounded only for Pebble: the other styles cut every control square. */
private fun Style.shape(radius: Dp): Shape = if (card == CardShape.Pebble) RoundedCornerShape(radius) else RectangleShape

@Composable
fun Txt(text: String, p: Palette, size: Float = 15f, color: Color = p.ink, weight: FontWeight = FontWeight.Normal,
        display: Boolean = false, modifier: Modifier = Modifier, lineHeight: Float = 1.45f) {
    val st = LocalStyle.current
    BasicText(text, modifier, style = TextStyle(
        color = color, fontSize = size.sp, fontWeight = weight, lineHeight = (size * lineHeight).sp,
        fontFamily = if (display) Display else FontFamily.Default,
        fontStyle = if (display && st.italic) FontStyle.Italic else FontStyle.Normal,
        letterSpacing = if (display) st.tracking.em else 0.em))
}

@Composable
fun Card(p: Palette, modifier: Modifier = Modifier, fill: Color = p.surface, bordered: Boolean = true, content: @Composable ColumnScope.() -> Unit) {
    when (LocalStyle.current.card) {
        CardShape.Pebble -> Column(modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(fill)
            .then(if (bordered) Modifier.border(1.dp, p.rule, RoundedCornerShape(18.dp)) else Modifier), content = content)
        // The shadow is drawn 3 dp outside, so the card leaves that room on the right and bottom.
        CardShape.Engraving -> Column(modifier.fillMaxWidth().padding(end = 3.dp, bottom = 3.dp).drawBehind {
            drawRect(Color.Black.copy(alpha = .1f), Offset(3.dp.toPx(), 3.dp.toPx()), size)
        }.background(fill).border(1.dp, p.paperLine), content = content)
        // Double frame: ink line, 3 dp of surface, rule line.
        CardShape.Frame -> Column(modifier.fillMaxWidth().background(fill).border(1.dp, p.ink).padding(4.dp).border(1.dp, p.rule).padding(1.dp), content = content)
    }
}

@Composable
fun Switch(on: Boolean, p: Palette, enabled: Boolean = true) {
    val track = if (on) p.water else p.surface3
    Box(Modifier.size(46.dp, 28.dp).background(track.copy(alpha = if (enabled) 1f else .45f), RoundedCornerShape(14.dp))) {
        Box(Modifier.padding(start = if (on) 21.dp else 3.dp, top = 3.dp).size(22.dp).background(p.surface, CircleShape))
    }
}

@Composable
fun SwitchRow(title: String, sub: String?, on: Boolean, p: Palette, first: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().then(if (first) Modifier else Modifier.drawBehind {
            drawLine(p.rule, Offset(0f, 0f), Offset(size.width, 0f), 1.dp.toPx())
        }).toggleable(on, role = Role.Switch, onValueChange = onChange).heightIn(min = 56.dp).padding(horizontal = 16.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Txt(title, p)
            if (sub != null) Txt(sub, p, 13f, p.muted)
        }
        Switch(on, p)
    }
}

@Composable
fun PillButton(text: String, p: Palette, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        Modifier.fillMaxWidth().height(48.dp).background(p.ink.copy(alpha = if (enabled) 1f else .4f), LocalStyle.current.shape(24.dp))
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Txt(text, p, 15f, p.onInk, FontWeight.SemiBold) }
}

/** Title with the style's underline behind it. */
@Composable
fun DabTitle(text: String, p: Palette) {
    val st = LocalStyle.current
    BasicText(text, Modifier.drawBehind {
        when (st.underline) {
            Underline.Dabs -> dabs(p)
            Underline.Rubbing -> rubbing(p)
            Underline.Sky -> sky(p)
        }
    }, style = TextStyle(color = p.ink, fontSize = 44.sp, lineHeight = 45.sp, fontFamily = Display,
        fontStyle = if (st.italic) FontStyle.Italic else FontStyle.Normal, letterSpacing = st.tracking.em))
}

private fun DrawScope.dabs(p: Palette) {
    val d = density
    withTransform({ rotate(-2f, Offset(-4 * d + 95 * d, size.height - 10 * d)) }) {
        drawRoundRect(p.water.copy(alpha = .28f), Offset(-4 * d, size.height - 16 * d), Size(190 * d, 12 * d), CornerRadius(6 * d))
    }
    withTransform({ rotate(3f, Offset(175 * d, size.height - 5 * d)) }) {
        drawRoundRect(p.atelier.copy(alpha = .35f), Offset(120 * d, size.height - 10 * d), Size(110 * d, 10 * d), CornerRadius(5 * d))
    }
}

/** A strip of torn paper with grain lines, like a pencil rubbing over wood. The ragged edges come from a fixed pattern, so nothing moves between frames. */
private fun DrawScope.rubbing(p: Palette) {
    val d = density
    val x0 = -4 * d; val w = 234 * d; val top = size.height - 16 * d; val h = 14 * d
    val step = 6 * d; val n = (w / step).toInt()
    fun jitter(i: Int) = ((i * 7 + 3) % 5 - 2) * .4f * d
    val torn = Path().apply {
        moveTo(x0, top + jitter(0))
        for (i in 1..n) lineTo(x0 + i * step, top + jitter(i))
        lineTo(x0 + w, top + h + jitter(n + 1))
        for (i in n downTo 0) lineTo(x0 + i * step, top + h + jitter(i + 2))
        close()
    }
    // Wood at full strength would swallow the dark title text, so it is laid on thin.
    drawPath(torn, p.wood.copy(alpha = .6f))
    for (k in 0 until 4) {
        val y = top + h * (k + 1) / 5f
        drawLine(p.scratch, Offset(x0 + (k * 11 % 7 + 2) * d, y), Offset(x0 + w - (k * 13 % 9 + 2) * d, y), .8f * d)
    }
}

/** A strip of sky with three small clouds and a hairline outline. */
private fun DrawScope.sky(p: Palette) {
    val d = density
    val x0 = -4 * d; val w = 234 * d; val top = size.height - 16 * d; val h = 14 * d
    drawRect(Brush.verticalGradient(listOf(p.skyTop, p.skyLow), startY = top, endY = top + h), Offset(x0, top), Size(w, h))
    for ((cx, cy, r) in listOf(Triple(40f, 8f, 1f), Triple(120f, 6f, 1.2f), Triple(190f, 9f, .9f))) {
        val x = x0 + cx * d; val y = top + cy * d; val u = r * d
        fun puff(dx: Float, dy: Float, rx: Float, ry: Float, c: Color) =
            drawOval(c, Offset(x + (dx - rx) * u, y + (dy - ry) * u), Size(2 * rx * u, 2 * ry * u))
        puff(0f, 1.2f, 9f, 2.4f, p.cloudShade)
        puff(0f, 0f, 8f, 2.6f, p.cloud); puff(-3f, -1.6f, 3.6f, 2.8f, p.cloud); puff(2.5f, -2f, 4.2f, 3.2f, p.cloud)
    }
    drawRect(p.ink, Offset(x0, top), Size(w, h), style = Stroke(1.dp.toPx()))
}

@Composable
fun Field(value: String, label: String, p: Palette, onChange: (String) -> Unit, keyboard: KeyboardOptions = KeyboardOptions.Default, tabular: Boolean = false,
          visual: VisualTransformation = VisualTransformation.None) {
    val shape = LocalStyle.current.shape(14.dp)
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Txt(label, p, 13f, p.muted)
        Box(Modifier.fillMaxWidth().height(52.dp).background(p.surface, shape).border(1.dp, p.rule, shape).padding(horizontal = 16.dp),
            contentAlignment = Alignment.CenterStart) {
            BasicTextField(value, onChange, visualTransformation = visual, singleLine = true, keyboardOptions = keyboard, cursorBrush = SolidColor(p.sun),
                textStyle = TextStyle(color = p.ink, fontSize = 17.sp, letterSpacing = if (tabular) 2.sp else 0.sp),
                modifier = Modifier.fillMaxWidth())
        }
    }
}

/** Shows ABCD-EFGH in capitals while the stored value stays what was typed (changing the text under the IME drops characters). */
object CodeDash : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText {
        val t = text.text.uppercase()
        val out = if (t.length > 4) t.substring(0, 4) + "-" + t.substring(4) else t
        return TransformedText(AnnotatedString(out), object : OffsetMapping {
            override fun originalToTransformed(offset: Int) = if (offset > 4) offset + 1 else offset
            override fun transformedToOriginal(offset: Int) = if (offset > 4) offset - 1 else offset
        })
    }
}
