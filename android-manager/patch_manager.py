from pathlib import Path

p = Path('android-manager/app/src/main/java/vn/svframe/bestiary/manager/GithubDistributionService.java')
s = p.read_text(encoding='utf-8')

old = '        JSONObject announcement=new JSONObject();announcement.put("title",clean(req.announcementTitle,req.title));announcement.put("body",clean(req.announcementBody,req.changelog));announcement.put("timestamp",timestamp);upsertText(repo,DIST+"/announcements.json",announcement.toString(2),"Update Bestiary announcement");\n'
new = '''        JSONObject announcementMeta=getContent(repo,DIST+"/announcements.json");JSONObject announcements=new JSONObject();if(announcementMeta!=null&&announcementMeta.has("content")){try{String encoded=announcementMeta.getString("content").replace("\\n","");String decoded=new String(Base64.decode(encoded,Base64.DEFAULT),StandardCharsets.UTF_8);announcements=new JSONObject(decoded);}catch(Exception ignored){announcements=new JSONObject();}}JSONArray oldItems=announcements.optJSONArray("items");JSONArray items=new JSONArray();JSONObject announcement=new JSONObject();announcement.put("id","announcement-"+timestamp);announcement.put("title",clean(req.announcementTitle,req.title));announcement.put("body",clean(req.announcementBody,req.changelog));announcement.put("timestamp",timestamp);items.put(announcement);if(oldItems!=null){for(int i=0;i<oldItems.length()&&i<49;i++)items.put(oldItems.get(i));}JSONObject announcementRoot=new JSONObject();announcementRoot.put("items",items);upsertText(repo,DIST+"/announcements.json",announcementRoot.toString(2),"Update Bestiary announcement");\n'''
if old not in s: raise SystemExit('announcement marker missing')
s = s.replace(old, new, 1)
s = s.replace('if(allow404&&code==404){consume(c);return null;}', 'if(allow404&&code==404){c.disconnect();return null;}')
p.write_text(s, encoding='utf-8')
print('Bestiary Manager compatibility patch applied')
