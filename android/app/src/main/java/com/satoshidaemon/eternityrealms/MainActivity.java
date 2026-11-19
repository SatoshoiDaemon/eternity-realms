package com.satoshidaemon.eternityrealms;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(BackupSchedulerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
