package com.satoshidaemon.eternityrealms;

import android.system.Os;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Comparator;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "BackupScheduler")
public class BackupSchedulerPlugin extends Plugin {
    private static final String WORK_NAME = "eternity-realms-automatic-backup";
    private static final String PREFERENCES = "eternity-realms-backups";

    @PluginMethod
    public void configure(PluginCall call) {
        String frequency = call.getString("frequency", "off");
        int retention = call.getInt("retention", 7);
        if (!frequency.equals("off") && !frequency.equals("daily") && !frequency.equals("weekly")) {
            call.reject("Frequência de backup inválida.");
            return;
        }
        if (retention < 1 || retention > 30) {
            call.reject("A retenção de backup deve ficar entre 1 e 30.");
            return;
        }

        getContext()
            .getSharedPreferences(PREFERENCES, 0)
            .edit()
            .putString("frequency", frequency)
            .putInt("retention", retention)
            .apply();

        WorkManager workManager = WorkManager.getInstance(getContext());
        if (frequency.equals("off")) {
            workManager.cancelUniqueWork(WORK_NAME);
        } else {
            long interval = frequency.equals("daily") ? 1 : 7;
            PeriodicWorkRequest request =
                new PeriodicWorkRequest.Builder(AutomaticBackupWorker.class, interval, TimeUnit.DAYS)
                    .build();
            workManager.enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                request
            );
        }

        JSObject result = new JSObject();
        result.put("frequency", frequency);
        result.put("retention", retention);
        call.resolve(result);
    }

    @PluginMethod
    public void setMetadata(PluginCall call) {
        String applicationVersion = call.getString("applicationVersion", BuildConfig.VERSION_NAME);
        String modDependencies = call.getString("modDependencies", "[]");
        getContext()
            .getSharedPreferences(PREFERENCES, 0)
            .edit()
            .putString("applicationVersion", applicationVersion)
            .putString("modDependencies", modDependencies)
            .apply();
        call.resolve();
    }

    @PluginMethod
    public synchronized void setSnapshot(PluginCall call) {
        String payload = call.getString("payload");
        if (payload == null) {
            call.reject("O conteúdo do save está ausente.");
            return;
        }
        try {
            new JSONObject(payload);
            File destination = new File(getContext().getFilesDir(), "latest-save.json");
            File temporary = new File(getContext().getFilesDir(), "latest-save.json.tmp");
            try (FileOutputStream stream = new FileOutputStream(temporary)) {
                stream.write(payload.getBytes(StandardCharsets.UTF_8));
                stream.getFD().sync();
            }
            Os.rename(temporary.getAbsolutePath(), destination.getAbsolutePath());
            call.resolve();
        } catch (Exception error) {
            call.reject("Não foi possível atualizar o save do backup automático.", error);
        }
    }

    @PluginMethod
    public void writeBackup(PluginCall call) {
        String payload = call.getString("payload");
        if (payload == null) {
            call.reject("O conteúdo do backup está ausente.");
            return;
        }
        try {
            new JSONObject(payload);
            File directory = new File(getContext().getFilesDir(), "backups");
            if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("Não foi possível criar a pasta de backups.");
            long now = System.currentTimeMillis();
            String filename = "manual-" + now + ".json";
            File temporary = new File(directory, filename + ".tmp");
            try (FileOutputStream stream = new FileOutputStream(temporary)) {
                stream.write(payload.getBytes(StandardCharsets.UTF_8));
                stream.getFD().sync();
            }
            File destination = new File(directory, filename);
            if (!temporary.renameTo(destination)) throw new IllegalStateException("Não foi possível finalizar o backup.");
            JSObject result = new JSObject();
            result.put("id", filename);
            result.put("createdAt", now);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Não foi possível criar o backup local.", error);
        }
    }

    @PluginMethod
    public void listBackups(PluginCall call) {
        File directory = new File(getContext().getFilesDir(), "backups");
        File[] files = directory.listFiles((folder, name) ->
            (name.startsWith("auto-") || name.startsWith("manual-")) && name.endsWith(".json")
        );
        if (files == null) files = new File[0];
        Arrays.sort(files, Comparator.comparingLong(File::lastModified).reversed());
        JSONArray backups = new JSONArray();
        for (File file : files) {
            try {
                String content = readFile(file);
                JSONObject envelope = new JSONObject(content);
                JSONObject gameState = envelope.optJSONObject("gameState");
                JSONObject character = gameState == null ? null : gameState.optJSONObject("character");
                JSONObject backup = new JSONObject();
                backup.put("id", file.getName());
                backup.put("createdAt", file.lastModified());
                backup.put("characterName", character == null ? "Sem personagem" : character.optString("name", "Sem personagem"));
                backup.put("automatic", file.getName().startsWith("auto-"));
                backups.put(backup);
            } catch (Exception ignored) {
                // Ignore corrupt backup files in the user-facing listing; restore reports integrity errors.
            }
        }
        JSObject result = new JSObject();
        result.put("backups", backups);
        call.resolve(result);
    }

    @PluginMethod
    public void readBackup(PluginCall call) {
        String id = call.getString("id");
        if (id == null || !id.matches("(auto|manual)-[0-9]+\\.json")) {
            call.reject("Identificador de backup inválido.");
            return;
        }
        File file = new File(new File(getContext().getFilesDir(), "backups"), id);
        if (!file.isFile()) {
            call.reject("Backup não encontrado.");
            return;
        }
        try {
            JSObject result = new JSObject();
            result.put("payload", readFile(file));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Não foi possível ler o backup.", error);
        }
    }

    private String readFile(File file) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (FileInputStream stream = new FileInputStream(file)) {
            byte[] buffer = new byte[8_192];
            int count;
            while ((count = stream.read(buffer)) != -1) output.write(buffer, 0, count);
        }
        return new String(output.toByteArray(), StandardCharsets.UTF_8);
    }
}
