package vn.svframe.bestiary.manager;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final int REQ_WORKSPACE=7001; private static final String PREFS="bestiary_manager",WORKSPACE="workspace_uri";
    private final ExecutorService executor=Executors.newSingleThreadExecutor();
    private EditText repo,version,title,changelog,discord,announcementTitle,announcementBody,serverName,serverHost,serverPort,minecraft,loader,javaMajor,token;
    private Spinner channel; private TextView workspaceText,status; private ProgressBar progress; private Uri workspaceUri;
    @Override protected void onCreate(Bundle b){super.onCreate(b);setContentView(buildUi());loadPrefs();}
    private View buildUi(){ScrollView scroll=new ScrollView(this);LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(dp(18),dp(18),dp(18),dp(32));root.setBackgroundColor(Color.rgb(248,248,248));scroll.addView(root,new ScrollView.LayoutParams(-1,-2));
        root.addView(text("Bestiary Pack Manager",24,true));TextView sub=text("SVFrame Team Studio · Android",13,false);sub.setTextColor(Color.DKGRAY);root.addView(sub);addSpace(root,14);
        repo=field(root,"Repository","aristheg201/bestiary-distribution");token=field(root,"GitHub token","fine-grained token");token.setInputType(0x81);Button save=button("LƯU TOKEN AN TOÀN");save.setOnClickListener(v->saveToken());root.addView(save);
        workspaceText=text("Workspace: chưa chọn",13,false);root.addView(workspaceText);Button pick=button("CHỌN THƯ MỤC PACK");pick.setOnClickListener(v->pickWorkspace());root.addView(pick);
        version=field(root,"Version","1.0.0");title=field(root,"Tiêu đề release","Bestiary Rebirth 1.0.0");changelog=multiline(root,"Changelog");channel=new Spinner(this);channel.setAdapter(new ArrayAdapter<>(this,android.R.layout.simple_spinner_dropdown_item,new String[]{"testing","stable"}));label(root,"Channel");root.addView(channel);
        serverName=field(root,"Tên máy chủ","Bestiary Rebirth");serverHost=field(root,"Host / IP","play.svframe.net");serverPort=field(root,"Port","25565");serverPort.setInputType(2);minecraft=field(root,"Minecraft","1.21.1");loader=field(root,"Fabric Loader","0.18.4");javaMajor=field(root,"Java","21");javaMajor.setInputType(2);discord=field(root,"Discord URL","https://discord.gg/...");announcementTitle=field(root,"Tiêu đề thông báo","Cập nhật mới");announcementBody=multiline(root,"Nội dung thông báo");
        Button pub=button("PUBLISH");pub.setOnClickListener(v->publish());root.addView(pub);Button stable=button("PROMOTE STABLE");stable.setOnClickListener(v->promoteStable());root.addView(stable);
        progress=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);progress.setMax(1000);progress.setVisibility(View.GONE);root.addView(progress,new LinearLayout.LayoutParams(-1,dp(8)));status=text("Sẵn sàng",13,false);status.setPadding(0,dp(10),0,0);root.addView(status);return scroll;}
    private void loadPrefs(){SharedPreferences p=getSharedPreferences(PREFS,MODE_PRIVATE);repo.setText(p.getString("repo","aristheg201/bestiary-distribution"));serverName.setText(p.getString("serverName","Bestiary Rebirth"));serverHost.setText(p.getString("serverHost","play.svframe.net"));serverPort.setText(p.getString("serverPort","25565"));minecraft.setText(p.getString("minecraft","1.21.1"));loader.setText(p.getString("loader","0.18.4"));javaMajor.setText(p.getString("java","21"));discord.setText(p.getString("discord",""));String stored=p.getString(WORKSPACE,null);if(stored!=null){workspaceUri=Uri.parse(stored);workspaceText.setText("Workspace: "+workspaceUri);}token.setHint(SecureTokenStore.hasToken(this)?"Token đã lưu trong Android Keystore":"fine-grained token");}
    private void savePrefs(){getSharedPreferences(PREFS,MODE_PRIVATE).edit().putString("repo",val(repo)).putString("serverName",val(serverName)).putString("serverHost",val(serverHost)).putString("serverPort",val(serverPort)).putString("minecraft",val(minecraft)).putString("loader",val(loader)).putString("java",val(javaMajor)).putString("discord",val(discord)).apply();}
    private void saveToken(){try{SecureTokenStore.save(this,val(token));token.setText("");token.setHint("Token đã lưu trong Android Keystore");toast("Đã lưu token.");}catch(Exception e){toast(e.getMessage());}}
    private void pickWorkspace(){Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION|Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);startActivityForResult(i,REQ_WORKSPACE);}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==REQ_WORKSPACE&&result==RESULT_OK&&data!=null&&data.getData()!=null){workspaceUri=data.getData();int flags=data.getFlags()&(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);try{getContentResolver().takePersistableUriPermission(workspaceUri,flags);}catch(Exception ignored){}getSharedPreferences(PREFS,MODE_PRIVATE).edit().putString(WORKSPACE,workspaceUri.toString()).apply();workspaceText.setText("Workspace: "+workspaceUri);}}
    private void publish(){savePrefs();if(workspaceUri==null){toast("Chưa chọn workspace.");return;}setBusy(true,"Đang chuẩn bị publish...");executor.execute(()->{try{String saved=SecureTokenStore.load(this);if(saved==null||saved.trim().isEmpty())throw new IllegalStateException("Chưa lưu GitHub token.");GithubDistributionService svc=new GithubDistributionService(this,saved);Models.ProgressSink sink=(m,c,t)->runOnUiThread(()->updateProgress(m,c,t));List<Models.ManagedFile> files=svc.scanWorkspace(workspaceUri,sink);Models.PublishRequest r=collect(files);svc.publish(r,sink);runOnUiThread(()->{setBusy(false,"Publish hoàn tất: "+r.version+" → "+r.channel);toast("Publish xong.");});}catch(Exception e){runOnUiThread(()->setBusy(false,"Lỗi: "+e.getMessage()));}});}
    private void promoteStable(){savePrefs();setBusy(true,"Đang promote Stable...");executor.execute(()->{try{String saved=SecureTokenStore.load(this);if(saved==null)throw new IllegalStateException("Chưa lưu GitHub token.");new GithubDistributionService(this,saved).promoteStable(val(repo),val(version),val(title),val(changelog));runOnUiThread(()->setBusy(false,"Đã promote Stable: "+val(version)));}catch(Exception e){runOnUiThread(()->setBusy(false,"Lỗi: "+e.getMessage()));}});}
    private Models.PublishRequest collect(List<Models.ManagedFile> files){Models.PublishRequest r=new Models.PublishRequest();r.repository=val(repo);r.version=val(version);r.title=val(title);r.changelog=val(changelog);r.channel=(String)channel.getSelectedItem();r.discordUrl=val(discord);r.announcementTitle=val(announcementTitle);r.announcementBody=val(announcementBody);r.serverName=val(serverName);r.serverHost=val(serverHost);r.serverPort=parseInt(val(serverPort),25565);r.minecraftVersion=val(minecraft);r.loaderVersion=val(loader);r.javaMajor=parseInt(val(javaMajor),21);r.files.addAll(files);return r;}
    private void setBusy(boolean b,String m){progress.setVisibility(b?View.VISIBLE:View.GONE);status.setText(m);}private void updateProgress(String m,int c,int t){status.setText(m);if(t>0)progress.setProgress((int)(1000L*c/t));}private static String val(EditText e){return e.getText().toString().trim();}private static int parseInt(String s,int d){try{return Integer.parseInt(s);}catch(Exception e){return d;}}private void toast(String s){Toast.makeText(this,s==null?"Lỗi":s,Toast.LENGTH_LONG).show();}
    private EditText field(LinearLayout r,String n,String h){label(r,n);EditText e=new EditText(this);e.setHint(h);e.setSingleLine(true);r.addView(e,new LinearLayout.LayoutParams(-1,dp(48)));return e;}private EditText multiline(LinearLayout r,String n){label(r,n);EditText e=new EditText(this);e.setMinLines(3);e.setGravity(Gravity.TOP);r.addView(e,new LinearLayout.LayoutParams(-1,dp(92)));return e;}private void label(LinearLayout r,String s){TextView t=text(s,12,true);t.setTextColor(Color.DKGRAY);t.setPadding(0,dp(11),0,0);r.addView(t);}private TextView text(String s,int sp,boolean bold){TextView t=new TextView(this);t.setText(s);t.setTextSize(sp);t.setTextColor(Color.rgb(20,20,20));if(bold)t.setTypeface(null,1);return t;}private Button button(String s){Button b=new Button(this);b.setText(s);LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,dp(52));p.setMargins(0,dp(8),0,0);b.setLayoutParams(p);return b;}private void addSpace(LinearLayout r,int h){r.addView(new View(this),new LinearLayout.LayoutParams(1,dp(h)));}private int dp(int v){return(int)(v*getResources().getDisplayMetrics().density+0.5f);}
}
