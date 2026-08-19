package vn.svframe.bestiary.manager;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

final class GithubDistributionService {
    private static final String API="https://api.github.com", UPLOAD="https://uploads.github.com", DIST="bestiary-distribution", OBJECT_TAG="bestiary-objects";
    private static final String[] ROOTS={"mods","config","resourcepacks"};
    private final Context context; private final String token;
    GithubDistributionService(Context context,String token){this.context=context.getApplicationContext();this.token=token.trim();}

    List<Models.ManagedFile> scanWorkspace(Uri treeUri, Models.ProgressSink progress) throws Exception {
        ContentResolver resolver=context.getContentResolver(); String rootId=DocumentsContract.getTreeDocumentId(treeUri);
        Map<String,Node> top=listChildren(resolver,treeUri,rootId); List<Models.ManagedFile> files=new ArrayList<>();
        for(String root:ROOTS){Node n=top.get(root); if(n!=null&&n.directory) walk(resolver,treeUri,n.documentId,root,files,progress);} return files;
    }

    void publish(Models.PublishRequest req, Models.ProgressSink progress) throws Exception {
        Repo repo=Repo.parse(req.repository); if(clean(req.version,"").isEmpty())throw new IllegalArgumentException("Version đang trống."); if(req.files.isEmpty())throw new IllegalArgumentException("Workspace không có file managed trong mods/config/resourcepacks.");
        long timestamp=System.currentTimeMillis(); int releaseId=ensureObjectRelease(repo); JSONArray filesJson=new JSONArray(); int total=req.files.size(),done=0;
        for(Models.ManagedFile file:req.files){done++;String asset="o-"+file.hash+".bin";progress.update("Object "+done+"/"+total+": "+file.path,done,total);if(!releaseAssetExists(repo,releaseId,asset))uploadAsset(repo,releaseId,asset,file);JSONObject f=new JSONObject();f.put("path",file.path);f.put("hash",file.hash);f.put("size",file.size);f.put("downloadUrl","https://github.com/"+repo.full+"/releases/download/"+OBJECT_TAG+"/"+asset);filesJson.put(f);}
        JSONObject runtime=new JSONObject();runtime.put("version",clean(req.minecraftVersion,"1.21.1"));runtime.put("loader","fabric");runtime.put("loaderVersion",clean(req.loaderVersion,"0.18.4"));runtime.put("javaMajor",req.javaMajor<=0?21:req.javaMajor);
        JSONObject manifest=new JSONObject();manifest.put("version",req.version.trim());manifest.put("timestamp",timestamp);manifest.put("minecraft",runtime);manifest.put("files",filesJson);
        String manifestPath=DIST+"/releases/"+req.version.trim()+"/manifest.json";upsertText(repo,manifestPath,manifest.toString(2),"Publish Bestiary release "+req.version.trim());
        JSONObject config=new JSONObject();config.put("discordUrl",clean(req.discordUrl,""));config.put("serverName",clean(req.serverName,"Bestiary Rebirth"));config.put("serverHost",clean(req.serverHost,""));config.put("serverPort",req.serverPort<=0?25565:req.serverPort);config.put("defaultMinecraftVersion",runtime.getString("version"));config.put("defaultFabricLoader",runtime.getString("loaderVersion"));config.put("javaMajor",runtime.getInt("javaMajor"));upsertText(repo,DIST+"/config.json",config.toString(2),"Update Bestiary launcher config");
        JSONObject announcement=new JSONObject();announcement.put("title",clean(req.announcementTitle,req.title));announcement.put("body",clean(req.announcementBody,req.changelog));announcement.put("timestamp",timestamp);upsertText(repo,DIST+"/announcements.json",announcement.toString(2),"Update Bestiary announcement");
        String manifestUrl="https://raw.githubusercontent.com/"+repo.full+"/main/"+manifestPath;JSONObject channel=new JSONObject();channel.put("version",req.version.trim());channel.put("manifestUrl",manifestUrl);channel.put("timestamp",timestamp);channel.put("title",clean(req.title,"Bestiary "+req.version.trim()));channel.put("changelog",clean(req.changelog,""));String channelName="stable".equalsIgnoreCase(req.channel)?"stable":"testing";upsertText(repo,DIST+"/channels/"+channelName+".json",channel.toString(2),"Publish Bestiary "+channelName+" channel");
    }

    void promoteStable(String repository,String version,String title,String changelog)throws Exception{Repo repo=Repo.parse(repository);String path=DIST+"/releases/"+version.trim()+"/manifest.json";if(getContent(repo,path)==null)throw new FileNotFoundException("Không tìm thấy release "+version);JSONObject c=new JSONObject();c.put("version",version.trim());c.put("manifestUrl","https://raw.githubusercontent.com/"+repo.full+"/main/"+path);c.put("timestamp",System.currentTimeMillis());c.put("title",clean(title,"Bestiary "+version.trim()));c.put("changelog",clean(changelog,""));upsertText(repo,DIST+"/channels/stable.json",c.toString(2),"Promote Bestiary "+version.trim()+" to stable");}

    private void walk(ContentResolver r,Uri tree,String parent,String dir,List<Models.ManagedFile> out,Models.ProgressSink progress)throws Exception{for(Node child:listChildren(r,tree,parent).values()){String relative=dir+"/"+child.name;if(child.directory)walk(r,tree,child.documentId,relative,out,progress);else{progress.update("Đang hash: "+relative,out.size(),0);try(InputStream in=r.openInputStream(child.uri)){if(in==null)throw new IOException("Không đọc được "+relative);out.add(new Models.ManagedFile(relative.replace('\\','/'),sha256(in),child.size,child.uri));}}}}
    private Map<String,Node> listChildren(ContentResolver r,Uri tree,String parent)throws Exception{Uri u=DocumentsContract.buildChildDocumentsUriUsingTree(tree,parent);Map<String,Node> out=new HashMap<>();String[] p={DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE,DocumentsContract.Document.COLUMN_SIZE};try(Cursor c=r.query(u,p,null,null,null)){if(c==null)return out;int id=c.getColumnIndexOrThrow(p[0]),name=c.getColumnIndexOrThrow(p[1]),mime=c.getColumnIndexOrThrow(p[2]),size=c.getColumnIndex(p[3]);while(c.moveToNext()){String did=c.getString(id),dn=c.getString(name),mt=c.getString(mime);long sz=size>=0&&!c.isNull(size)?c.getLong(size):0L;out.put(dn,new Node(did,dn,DocumentsContract.Document.MIME_TYPE_DIR.equals(mt),sz,DocumentsContract.buildDocumentUriUsingTree(tree,did)));}}return out;}
    private int ensureObjectRelease(Repo repo)throws Exception{JSONObject e=requestJson("GET",API+"/repos/"+repo.full+"/releases/tags/"+OBJECT_TAG,null,null,true);if(e!=null)return e.getInt("id");JSONObject b=new JSONObject();b.put("tag_name",OBJECT_TAG);b.put("name","Bestiary Object Store");b.put("draft",false);b.put("prerelease",false);b.put("generate_release_notes",false);return requestJson("POST",API+"/repos/"+repo.full+"/releases","application/json",b.toString().getBytes(StandardCharsets.UTF_8),false).getInt("id");}
    private boolean releaseAssetExists(Repo repo,int releaseId,String asset)throws Exception{JSONArray a=requestJson("GET",API+"/repos/"+repo.full+"/releases/"+releaseId,null,null,false).optJSONArray("assets");if(a==null)return false;for(int i=0;i<a.length();i++)if(asset.equals(a.getJSONObject(i).optString("name")))return true;return false;}
    private void uploadAsset(Repo repo,int releaseId,String asset,Models.ManagedFile file)throws Exception{String url=UPLOAD+"/repos/"+repo.full+"/releases/"+releaseId+"/assets?name="+URLEncoder.encode(asset,"UTF-8");HttpURLConnection c=open(url,"POST");c.setRequestProperty("Content-Type","application/octet-stream");c.setChunkedStreamingMode(1024*1024);c.setDoOutput(true);try(InputStream in=new BufferedInputStream(context.getContentResolver().openInputStream(file.uri));OutputStream out=new BufferedOutputStream(c.getOutputStream())){if(in==null)throw new IOException("Không mở được "+file.path);byte[] buf=new byte[1024*1024];int n;while((n=in.read(buf))!=-1)if(n>0)out.write(buf,0,n);}int code=c.getResponseCode();if(code<200||code>=300)throw apiError(c,code);consume(c);}
    private void upsertText(Repo repo,String path,String text,String message)throws Exception{JSONObject e=getContent(repo,path),b=new JSONObject();b.put("message",message);b.put("content",Base64.encodeToString(text.getBytes(StandardCharsets.UTF_8),Base64.NO_WRAP));b.put("branch","main");if(e!=null)b.put("sha",e.getString("sha"));requestJson("PUT",API+"/repos/"+repo.full+"/contents/"+encodePath(path),"application/json",b.toString().getBytes(StandardCharsets.UTF_8),false);}
    private JSONObject getContent(Repo repo,String path)throws Exception{return requestJson("GET",API+"/repos/"+repo.full+"/contents/"+encodePath(path)+"?ref=main",null,null,true);}
    private JSONObject requestJson(String method,String url,String type,byte[] body,boolean allow404)throws Exception{HttpURLConnection c=open(url,method);if(type!=null)c.setRequestProperty("Content-Type",type);if(body!=null){c.setDoOutput(true);c.setFixedLengthStreamingMode(body.length);try(OutputStream o=c.getOutputStream()){o.write(body);}}int code=c.getResponseCode();if(allow404&&code==404){consume(c);return null;}if(code<200||code>=300)throw apiError(c,code);String data=consume(c);return data.trim().isEmpty()?new JSONObject():new JSONObject(data);}
    private HttpURLConnection open(String url,String method)throws Exception{HttpURLConnection c=(HttpURLConnection)new URL(url).openConnection();c.setRequestMethod(method);c.setConnectTimeout(20000);c.setReadTimeout(120000);c.setUseCaches(false);c.setRequestProperty("Accept","application/vnd.github+json");c.setRequestProperty("Authorization","Bearer "+token);c.setRequestProperty("X-GitHub-Api-Version","2022-11-28");c.setRequestProperty("User-Agent","BestiaryPackManager-Android/1.0.0");return c;}
    private static IOException apiError(HttpURLConnection c,int code)throws IOException{String body;try{body=readStream(c.getErrorStream());}catch(Exception ignored){body="";}return new IOException("GitHub HTTP "+code+(body.isEmpty()?"":": "+body));}
    private static String consume(HttpURLConnection c)throws IOException{InputStream s=c.getInputStream();String body=readStream(s);c.disconnect();return body;}
    private static String readStream(InputStream in)throws IOException{if(in==null)return"";try(InputStream s=in;ByteArrayOutputStream o=new ByteArrayOutputStream()){byte[] b=new byte[16384];int n;while((n=s.read(b))!=-1)if(n>0)o.write(b,0,n);return o.toString("UTF-8");}}
    private static String sha256(InputStream in)throws Exception{MessageDigest md=MessageDigest.getInstance("SHA-256");byte[] b=new byte[1024*1024];int n;while((n=in.read(b))!=-1)if(n>0)md.update(b,0,n);StringBuilder s=new StringBuilder(64);for(byte x:md.digest())s.append(String.format(Locale.ROOT,"%02x",x&255));return s.toString();}
    private static String encodePath(String path)throws Exception{StringBuilder o=new StringBuilder();for(String p:path.split("/")){if(o.length()>0)o.append('/');o.append(URLEncoder.encode(p,"UTF-8").replace("+","%20"));}return o.toString();}
    private static String clean(String v,String fallback){String s=v==null?"":v.trim();return s.isEmpty()?(fallback==null?"":fallback):s;}
    private static final class Node{final String documentId,name;final boolean directory;final long size;final Uri uri;Node(String id,String n,boolean d,long s,Uri u){documentId=id;name=n;directory=d;size=s;uri=u;}}
    private static final class Repo{final String full;Repo(String f){full=f;}static Repo parse(String raw){String s=raw==null?"":raw.trim().replace("https://github.com/","").replace("http://github.com/","");while(s.endsWith("/"))s=s.substring(0,s.length()-1);if(s.endsWith(".git"))s=s.substring(0,s.length()-4);String[] p=s.split("/");if(p.length!=2||p[0].isEmpty()||p[1].isEmpty())throw new IllegalArgumentException("Repository phải có dạng owner/repo.");return new Repo(p[0]+"/"+p[1]);}}
}
