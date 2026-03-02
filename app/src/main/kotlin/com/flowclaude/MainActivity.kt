package com.flowclaude

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var btnInstall: Button
    private lateinit var tvLog: TextView
    private lateinit var scrollView: ScrollView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        btnInstall = findViewById(R.id.btnInstall)
        tvLog = findViewById(R.id.tvLog)
        scrollView = findViewById(R.id.scrollView)

        btnInstall.setOnClickListener {
            startInstall()
        }
    }

    private fun startInstall() {
        btnInstall.isEnabled = false
        tvLog.visibility = View.VISIBLE
        appendLog("Starting FlowClaude installation...")
        appendLog("Opening Termux to run installer...")

        val intent = Intent().apply {
            setClassName("com.termux", "com.termux.app.RunCommandService")
            action = "com.termux.RUN_COMMAND"
            putExtra(
                "com.termux.RUN_COMMAND_PATH",
                "/data/data/com.termux/files/usr/bin/bash"
            )
            putExtra(
                "com.termux.RUN_COMMAND_ARGUMENTS",
                arrayOf("/data/data/com.termux/files/home/FlowClaude/install.sh")
            )
            putExtra(
                "com.termux.RUN_COMMAND_WORKDIR",
                "/data/data/com.termux/files/home/FlowClaude"
            )
            // false = show terminal so user can see progress
            putExtra("com.termux.RUN_COMMAND_BACKGROUND", false)
            // keep terminal open when done so user can read output
            putExtra("com.termux.RUN_COMMAND_SESSION_ACTION", "0")
        }

        try {
            startService(intent)
            appendLog("Installer launched in Termux.")
            appendLog("Follow the progress in the Termux window.")
        } catch (e: Exception) {
            appendLog("ERROR: Could not start Termux.")
            appendLog("Make sure Termux (F-Droid version) is installed.")
            appendLog(e.message ?: "Unknown error")
            btnInstall.isEnabled = true
        }
    }

    private fun appendLog(message: String) {
        tvLog.append("$message\n")
        scrollView.post { scrollView.fullScroll(ScrollView.FOCUS_DOWN) }
    }
}
