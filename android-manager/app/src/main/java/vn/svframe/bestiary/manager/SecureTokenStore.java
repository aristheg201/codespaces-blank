package vn.svframe.bestiary.manager;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class SecureTokenStore {
    private static final String KEYSTORE="AndroidKeyStore", ALIAS="bestiary_manager_github_token_v1", PREFS="bestiary_manager_secrets", TOKEN="token", IV="iv";
    private SecureTokenStore() {}
    static void save(Context context, String token) throws Exception {
        String value=token==null?"":token.trim(); if(value.isEmpty()) throw new IllegalArgumentException("Token GitHub đang trống.");
        SecretKey key=getOrCreateKey(); Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE,key);
        byte[] encrypted=cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        context.getSharedPreferences(PREFS,Context.MODE_PRIVATE).edit().putString(TOKEN,Base64.encodeToString(encrypted,Base64.NO_WRAP)).putString(IV,Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)).apply();
    }
    static String load(Context context) throws Exception {
        SharedPreferences prefs=context.getSharedPreferences(PREFS,Context.MODE_PRIVATE); String c=prefs.getString(TOKEN,null), iv=prefs.getString(IV,null); if(c==null||iv==null)return null;
        KeyStore store=KeyStore.getInstance(KEYSTORE); store.load(null); KeyStore.Entry entry=store.getEntry(ALIAS,null); if(!(entry instanceof KeyStore.SecretKeyEntry))return null;
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE,((KeyStore.SecretKeyEntry)entry).getSecretKey(),new GCMParameterSpec(128,Base64.decode(iv,Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(c,Base64.NO_WRAP)),StandardCharsets.UTF_8);
    }
    static boolean hasToken(Context context){ return context.getSharedPreferences(PREFS,Context.MODE_PRIVATE).contains(TOKEN); }
    private static SecretKey getOrCreateKey() throws Exception {
        KeyStore store=KeyStore.getInstance(KEYSTORE); store.load(null); KeyStore.Entry entry=store.getEntry(ALIAS,null); if(entry instanceof KeyStore.SecretKeyEntry)return ((KeyStore.SecretKeyEntry)entry).getSecretKey();
        KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }
}
