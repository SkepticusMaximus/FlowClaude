package com.flowclaude

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var btnInstall: Button
    private lateinit var tvLog: TextView
    private lateinit var scrollView: ScrollView

    private lateinit var dotTermux: TextView
    private lateinit var dotExternal: TextView
    private lateinit var dotApi: TextView

    private lateinit var btnFixTermux: Button
    private lateinit var btnFixExternal: Button
    private lateinit var btnFixApi: Button

    private val prefs by lazy { getSharedPreferences("flowclaude", Context.MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        btnInstall   = findViewById(R.id.btnInstall)
        tvLog        = findViewById(R.id.tvLog)
        scrollView   = findViewById(R.id.scrollView)
        dotTermux    = findViewById(R.id.dot_termux)
        dotExternal  = findViewById(R.id.dot_external)
        dotApi       = findViewById(R.id.dot_api)
        btnFixTermux   = findViewById(R.id.btn_fix_termux)
        btnFixExternal = findViewById(R.id.btn_fix_external)
        btnFixApi      = findViewById(R.id.btn_fix_api)

        btnFixTermux.setOnClickListener   { openFDroid("com.termux") }
        btnFixExternal.setOnClickListener { showExternalAccessDialog() }
        btnFixApi.setOnClickListener      { openFDroid("com.termux.api") }
        btnInstall.setOnClickListener     { startInstall() }
    }

    override fun onResume() {
        super.onResume()
        recheckAll()
    }

    // ── Prerequisite checks ───────────────────────────────────────────────────

    private fun isTermuxInstalled(): Boolean = isPackageInstalled("com.termux")

    private fun isTermuxApiInstalled(): Boolean = isPackageInstalled("com.termux.api")

    private fun isExternalAccessConfirmed(): Boolean =
        prefs.getBoolean("external_access_confirmed", false)

    private fun isPackageInstalled(pkg: String): Boolean {
        return try {
            packageManager.getPackageInfo(pkg, PackageManager.GET_ACTIVITIES)
            true
        } catch (e: PackageManager.NameNotFoundException) {
            false
        }
    }

    // ── UI update ─────────────────────────────────────────────────────────────

    private fun recheckAll() {
        val termuxOk    = isTermuxInstalled()
        val externalOk  = isExternalAccessConfirmed()
        val apiOk       = isTermuxApiInstalled()

        setDot(dotTermux,   termuxOk)
        setDot(dotExternal, externalOk)
        setDot(dotApi,      apiOk)

        btnFixTermux.visibility  = if (termuxOk)   View.GONE else View.VISIBLE
        btnFixApi.visibility     = if (apiOk)      View.GONE else View.VISIBLE
        // External access SETUP button always visible (can't auto-detect state)
        btnFixExternal.text      = if (externalOk) "DONE ✓" else "SETUP"

        btnInstall.isEnabled = termuxOk && externalOk
    }

    private fun setDot(dot: TextView, passed: Boolean) {
        dot.setTextColor(getColor(if (passed) R.color.check_pass else R.color.check_fail))
    }

    // ── FIX actions ───────────────────────────────────────────────────────────

    private fun openFDroid(pkg: String) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW,
                Uri.parse("https://f-droid.org/packages/$pkg/")))
        } catch (e: Exception) {
            appendLog("Could not open browser: ${e.message}")
        }
    }

    private fun showExternalAccessDialog() {
        val command = "echo \"allow-external-apps=true\" >> ~/.termux/termux.properties && termux-reload-settings"

        val dialogView = layoutInflater.inflate(android.R.layout.simple_list_item_1, null)

        AlertDialog.Builder(this)
            .setTitle("Enable External App Access")
            .setMessage(
                "Termux needs to be told it's allowed to accept commands from FlowClaude.\n\n" +
                "1. Tap \"Copy Command\" below\n" +
                "2. Tap \"Open Termux\"\n" +
                "3. Paste and run the command\n" +
                "4. Come back here and tap \"I've Done This\"\n\n" +
                "Command:\n$command"
            )
            .setNeutralButton("Copy Command") { dialog, _ ->
                val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.setPrimaryClip(ClipData.newPlainText("termux-command", command))
                // Keep dialog open so user can also tap Open Termux
                (dialog as AlertDialog).getButton(AlertDialog.BUTTON_NEUTRAL)?.text = "Copied ✓"
            }
            .setNegativeButton("Open Termux") { _, _ ->
                try {
                    val intent = packageManager.getLaunchIntentForPackage("com.termux")
                        ?: throw Exception("Termux not installed")
                    startActivity(intent)
                } catch (e: Exception) {
                    appendLog("Could not open Termux: ${e.message}")
                }
            }
            .setPositiveButton("I've Done This") { _, _ ->
                prefs.edit().putBoolean("external_access_confirmed", true).apply()
                recheckAll()
            }
            .show()
    }

    // ── Install ───────────────────────────────────────────────────────────────

    private fun startInstall() {
        if (!isTermuxInstalled() || !isExternalAccessConfirmed()) {
            appendLog("Please complete the checklist above first.")
            return
        }

        btnInstall.isEnabled = false
        scrollView.visibility = View.VISIBLE
        appendLog("Starting FlowClaude installation...")
        appendLog("Launching installer in Termux...")

        val intent = Intent().apply {
            setClassName("com.termux", "com.termux.app.RunCommandService")
            action = "com.termux.RUN_COMMAND"
            putExtra("com.termux.RUN_COMMAND_PATH",
                "/data/data/com.termux/files/usr/bin/bash")
            putExtra("com.termux.RUN_COMMAND_ARGUMENTS",
                arrayOf("/data/data/com.termux/files/home/FlowClaude/install.sh"))
            putExtra("com.termux.RUN_COMMAND_WORKDIR",
                "/data/data/com.termux/files/home/FlowClaude")
            putExtra("com.termux.RUN_COMMAND_BACKGROUND", false)
            putExtra("com.termux.RUN_COMMAND_SESSION_ACTION", "0")
        }

        try {
            startService(intent)
            appendLog("✓ Installer launched. Follow progress in Termux.")
            appendLog("  Log will be saved to ~/flowclaude-install.log")
        } catch (e: SecurityException) {
            appendLog("✗ Permission denied — tap SETUP above to enable external access.")
            btnInstall.isEnabled = true
        } catch (e: Exception) {
            appendLog("✗ Could not start Termux: ${e.message}")
            appendLog("  Make sure Termux (F-Droid version) is installed.")
            btnInstall.isEnabled = true
        }
    }

    // ── Log helpers ───────────────────────────────────────────────────────────

    private fun appendLog(message: String) {
        tvLog.append("$message\n")
        scrollView.post { scrollView.fullScroll(ScrollView.FOCUS_DOWN) }
    }
}
