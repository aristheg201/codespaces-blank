package vn.svframe.bestiary.manager;

import android.net.Uri;
import java.util.ArrayList;
import java.util.List;

final class Models {
    private Models() {}
    static final class ManagedFile {
        final String path, hash; final long size; final Uri uri;
        ManagedFile(String path, String hash, long size, Uri uri) { this.path=path; this.hash=hash; this.size=size; this.uri=uri; }
    }
    static final class PublishRequest {
        String repository, version, title, changelog, channel, discordUrl, announcementTitle, announcementBody;
        String serverName, serverHost, minecraftVersion, loaderVersion;
        int serverPort, javaMajor;
        final List<ManagedFile> files = new ArrayList<>();
    }
    interface ProgressSink { void update(String message, int completed, int total); }
}
