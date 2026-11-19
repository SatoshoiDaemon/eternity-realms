package com.satoshidaemon.eternityrealms;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Comparator;
import org.json.JSONArray;
import org.json.JSONObject;

public class AutomaticBackupWorker extends Worker {
    private static final String PREFERENCES = "eternity-realms-backups";
    private static final String SNAPSHOT_FILE = "latest-save.json";

    public AutomaticBackupWorker(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
    }

    @NonNull
    @Override
    public Result doWork() {
        try {
            Context context = getApplicationContext();
            File snapshot = new File(context.getFilesDir(), SNAPSHOT_FILE);
            if (!snapshot.isFile()) return Result.success();
            String payload = readSnapshot(snapshot);
            long exportedAt = System.currentTimeMillis();
            JSONObject gameState = new JSONObject(payload);
            JSONObject envelope = new JSONObject();
            envelope.put("formatVersion", 1);
            envelope.put(
                "applicationVersion",
                context.getSharedPreferences(PREFERENCES, 0)
                    .getString("applicationVersion", BuildConfig.VERSION_NAME)
            );
            envelope.put("databaseVersion", 2);
            envelope.put("exportedAt", exportedAt);
            envelope.put("modDependencies", readModDependencies(context));
            envelope.put("gameState", gameState);

            File directory = new File(context.getFilesDir(), "backups");
            if (!directory.exists() && !directory.mkdirs()) return Result.retry();
            String filename = "auto-" + exportedAt + ".json";
            File temporary = new File(directory, filename + ".tmp");
            try (FileOutputStream stream = new FileOutputStream(temporary)) {
                stream.write(envelope.toString(2).getBytes(StandardCharsets.UTF_8));
                stream.getFD().sync();
            }
            File destination = new File(directory, filename);
            if (!temporary.renameTo(destination)) {
                temporary.delete();
                return Result.retry();
            }
            pruneBackups(directory, context.getSharedPreferences(PREFERENCES, 0).getInt("retention", 7));
            return Result.success();
        } catch (Exception error) {
            return Result.retry();
        }
    }

    private String readSnapshot(File file) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (FileInputStream stream = new FileInputStream(file)) {
            byte[] buffer = new byte[8_192];
            int count;
            while ((count = stream.read(buffer)) != -1) output.write(buffer, 0, count);
        }
        return new String(output.toByteArray(), StandardCharsets.UTF_8);
    }

    private JSONArray readModDependencies(Context context) {
        String json = context
            .getSharedPreferences(PREFERENCES, 0)
            .getString("modDependencies", "[]");
        try {
            return new JSONArray(json);
        } catch (Exception ignored) {
            return new JSONArray();
        }
    }

    private void pruneBackups(File directory, int retention) {
        File[] files = directory.listFiles((folder, name) -> name.startsWith("auto-") && name.endsWith(".json"));
        if (files == null || files.length <= retention) return;
        Arrays.sort(files, Comparator.comparingLong(File::lastModified).reversed());
        for (int index = retention; index < files.length; index++) {
            files[index].delete();
        }
    }
}
