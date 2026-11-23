package au.datacube.startupprobe;

import android.app.Activity;
import android.app.Instrumentation;
import android.app.UiAutomation;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityNodeInfo;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class StartupProbe extends Instrumentation {
    private static final String TARGET_PACKAGE = "au.datacube.app";
    private static final String START_ACTIVITY = "am start -W -f 0x10008000 -n " + TARGET_PACKAGE + "/.MainActivity";
    private static final Pattern TOTAL_TIME = Pattern.compile("(?m)^TotalTime: (\\d+)$");
    private static final Pattern LAUNCH_STATE = Pattern.compile("(?m)^LaunchState: (\\w+)$");
    private static final long OBSERVATION_TIMEOUT_MS = 12_000;
    private static final long OBSERVATION_INTERVAL_MS = 25;

    private Bundle arguments;

    @Override
    public void onCreate(Bundle arguments) {
        this.arguments = arguments;
        start();
    }

    @Override
    public void onStart() {
        Bundle result = new Bundle();
        try {
            boolean login = "login".equals(arguments.getString("screen"));
            String marker = login ? "Continue with Google" : "Active Documents";
            UiAutomation automation = getUiAutomation();
            long start = SystemClock.uptimeMillis();
            ParcelFileDescriptor output = automation.executeShellCommand(START_ACTIVITY);
            try (ParcelFileDescriptor.AutoCloseInputStream stream = new ParcelFileDescriptor.AutoCloseInputStream(output)) {
                long ready = awaitScreen(automation, marker, login, start);
                String launch = new String(stream.readAllBytes(), StandardCharsets.UTF_8);
                result.putString("launch_state", capture(launch, LAUNCH_STATE));
                result.putString("first_frame_ms", capture(launch, TOTAL_TIME));
                result.putString("screen_ready_ms", Long.toString(ready - start));
            }
            finish(Activity.RESULT_OK, result);
        } catch (IOException | IllegalStateException error) {
            result.putString("probe_error", error.toString());
            finish(Activity.RESULT_CANCELED, result);
        }
    }

    private static long awaitScreen(UiAutomation automation, String marker, boolean action, long start) {
        while (SystemClock.uptimeMillis() - start < OBSERVATION_TIMEOUT_MS) {
            AccessibilityNodeInfo root = automation.getRootInActiveWindow();
            if (root != null && TARGET_PACKAGE.equals(String.valueOf(root.getPackageName()))) {
                for (AccessibilityNodeInfo node : root.findAccessibilityNodeInfosByText(marker)) {
                    if (marker.equals(String.valueOf(node.getText())) && node.isVisibleToUser()
                            && (!action || hasEnabledAction(node))) {
                        return SystemClock.uptimeMillis();
                    }
                }
            }
            SystemClock.sleep(OBSERVATION_INTERVAL_MS);
        }
        throw new IllegalStateException("Timed out waiting for " + marker);
    }

    private static boolean hasEnabledAction(AccessibilityNodeInfo node) {
        for (AccessibilityNodeInfo candidate = node; candidate != null; candidate = candidate.getParent()) {
            if (candidate.isClickable()) {
                return candidate.isEnabled();
            }
        }
        return false;
    }

    private static String capture(String launch, Pattern pattern) {
        Matcher match = pattern.matcher(launch);
        if (!match.find()) {
            throw new IllegalStateException("Activity launch metrics missing: " + launch.replace('\n', ' '));
        }
        return match.group(1);
    }
}
