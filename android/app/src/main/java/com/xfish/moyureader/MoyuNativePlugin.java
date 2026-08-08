package com.xfish.moyureader;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "MoyuNative")
public class MoyuNativePlugin extends Plugin {
    private static final String KEY_ALIAS = "moyu_reader_api_key";
    private static final String PREFERENCES = "moyu_secure_preferences";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";

    @PluginMethod
    public void setReadingActive(PluginCall call) {
        boolean active = Boolean.TRUE.equals(call.getBoolean("active", false));
        getActivity().runOnUiThread(() -> ((MainActivity) getActivity()).setReadingActive(active));
        call.resolve();
    }

    @PluginMethod
    public void setImmersive(PluginCall call) {
        boolean active = Boolean.TRUE.equals(call.getBoolean("active", false));
        getActivity().runOnUiThread(() -> ((MainActivity) getActivity()).setMoyuImmersive(active));
        call.resolve();
    }

    @PluginMethod
    public void secureGet(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.isEmpty()) {
            call.reject("缺少安全存储键名");
            return;
        }
        try {
            String encoded = preferences().getString(key, null);
            JSObject result = new JSObject();
            result.put("value", encoded == null ? "" : decrypt(encoded));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("无法读取 Android 加密存储", error);
        }
    }

    @PluginMethod
    public void secureSet(PluginCall call) {
        String key = call.getString("key");
        String value = call.getString("value");
        if (key == null || key.isEmpty() || value == null) {
            call.reject("安全存储参数不完整");
            return;
        }
        try {
            if (!preferences().edit().putString(key, encrypt(value)).commit()) {
                throw new IllegalStateException("无法写入应用私有存储");
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("无法写入 Android 加密存储", error);
        }
    }

    @PluginMethod
    public void secureRemove(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.isEmpty()) {
            call.reject("缺少安全存储键名");
            return;
        }
        if (preferences().edit().remove(key).commit()) call.resolve();
        else call.reject("无法删除 Android 加密存储");
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    private SecretKey secretKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) return ((KeyStore.SecretKeyEntry) keyStore.getEntry(KEY_ALIAS, null)).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return generator.generateKey();
    }

    private String encrypt(String value) throws Exception {
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, secretKey());
        byte[] iv = cipher.getIV();
        byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        ByteBuffer payload = ByteBuffer.allocate(4 + iv.length + encrypted.length);
        payload.putInt(iv.length).put(iv).put(encrypted);
        return Base64.encodeToString(payload.array(), Base64.NO_WRAP);
    }

    private String decrypt(String encoded) throws Exception {
        ByteBuffer payload = ByteBuffer.wrap(Base64.decode(encoded, Base64.NO_WRAP));
        int ivLength = payload.getInt();
        if (ivLength < 12 || ivLength > 32 || payload.remaining() <= ivLength) throw new IllegalArgumentException("加密数据格式无效");
        byte[] iv = new byte[ivLength];
        byte[] encrypted = new byte[payload.remaining() - ivLength];
        payload.get(iv).get(encrypted);
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(128, iv));
        return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
    }
}
