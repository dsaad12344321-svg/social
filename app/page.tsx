"use client";

import { useEffect, useMemo, useState } from "react";

type Source = "certificates" | "deposits" | "treasury";
type Platform = "Facebook" | "Instagram" | "TikTok" | "X";
type Status = "draft" | "scheduled" | "published";

type Post = {
  id:string; source:Source; title:string; caption:string; image:string;
  platforms:Platform[]; status:Status; createdAt:string;
};

const STORAGE = "daleelak-social-posts-v1";
const BANKS_URL = "https://daleelakelbanky.vercel.app";
const generators: Record<Source,{label:string;path:string}> = {
  certificates:{label:"منشئ الشهادات",path:"/certificates-poster"},
  deposits:{label:"منشئ الودائع",path:"/deposits-poster"},
  treasury:{label:"منشئ أذون الخزانة",path:"/treasury-bills-poster"},
};

function titleFor(source:Source){return source==="certificates"?"شهادات البنوك المصرية":source==="deposits"?"ودائع البنوك المصرية":"أذون الخزانة المصرية";}

export default function Dashboard(){
  const [posts,setPosts]=useState<Post[]>([]);
  const [caption,setCaption]=useState("");
  const [image,setImage]=useState("");
  const [source,setSource]=useState<Source>("certificates");
  const [platforms,setPlatforms]=useState<Platform[]>(["Facebook","Instagram"]);
  const [section,setSection]=useState("Dashboard");

  useEffect(()=>{try{const raw=localStorage.getItem(STORAGE);if(raw)setPosts(JSON.parse(raw));}catch{}},[]);
  
  useEffect(() => {
  try {
    const postsForStorage = posts.map((post) => ({
      ...post,
      image: "",
    }));

    localStorage.setItem(STORAGE, JSON.stringify(postsForStorage));
  } catch (error) {
    console.error("Failed to save posts:", error);
  }
}, [posts]);

  useEffect(()=>{
    const onMessage=(event:MessageEvent)=>{
      const d=event.data;
      if(!d || d.type!=="DALEELAK_SOCIAL_POST") return;
      const s:Source=d.source==="treasury"||d.source==="deposits"?d.source:"certificates";
      setSource(s); setCaption(d.caption||""); setImage(d.image||""); setSection("Content");
      const post:Post={id:crypto.randomUUID(),source:s,title:d.title||titleFor(s),caption:d.caption||"",image:d.image||"",platforms:["Facebook","Instagram"],status:"draft",createdAt:new Date().toISOString()};
      setPosts(p=>[post,...p]);
    };
    window.addEventListener("message",onMessage);
    return()=>window.removeEventListener("message",onMessage);
  },[]);

  const stats=useMemo(()=>({
    drafts:posts.filter(p=>p.status==="draft").length,
    scheduled:posts.filter(p=>p.status==="scheduled").length,
    published:posts.filter(p=>p.status==="published").length,
    failed:0,
  }),[posts]);

  function openGenerator(s:Source){
    setSource(s);
    window.open(BANKS_URL+generators[s].path,"_blank","width=1450,height=1000");
  }
  function toggle(p:Platform){setPlatforms(x=>x.includes(p)?x.filter(v=>v!==p):[...x,p]);}
  function save(status:Status){
    if(!caption.trim()&&!image)return;
    setPosts(p=>[{id:crypto.randomUUID(),source,title:titleFor(source),caption,image,platforms,status,createdAt:new Date().toISOString()},...p]);
    setCaption("");setImage("");
  }
  function remove(id:string){setPosts(p=>p.filter(x=>x.id!==id));}

  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><strong>دليلك البنكي</strong><span>Social Media Manager</span></div>
      <nav>{["Dashboard","Content","Calendar","Accounts","Analytics","Settings"].map(x=><button key={x} className={section===x?"active":""} onClick={()=>setSection(x)}>{x}</button>)}</nav>
    </aside>

    <main className="main">
      <header><h1>لوحة تحكم السوشيال ميديا</h1><p>إدارة ونشر محتوى دليلك البنكي من مكان واحد</p></header>

      <section className="stats">
        <Stat label="Drafts" value={stats.drafts}/><Stat label="Scheduled" value={stats.scheduled}/><Stat label="Published" value={stats.published}/><Stat label="Failed" value={stats.failed}/>
      </section>

      <section className="grid">
        <div className="card queue">
          <h2>محتوى قيد النشر</h2><p className="muted">آخر المنشورات والمجدولة</p>
          <div className="posts">
            {posts.slice(0,5).map(p=><article className="post" key={p.id}>
              <div className="thumb">{p.image&&<img src={p.image} alt=""/>}</div>
              <div><h3>{p.title}</h3><p>{p.caption||"لا يوجد كابشن"}</p><small>{p.platforms.join(" • ")} · {p.status}</small></div>
            </article>)}
            {!posts.length&&<div className="empty">افتح أحد منشئات البوستات لإرسال الصورة والكابشن إلى الداشبورد.</div>}
          </div>
        </div>

        <div className="card composer">
          <h2>إنشاء منشور</h2>
          <label>مصدر المحتوى</label>
          <div className="source-list">{(Object.keys(generators) as Source[]).map(s=><button key={s} onClick={()=>openGenerator(s)}>{generators[s].label}</button>)}</div>
          <label>Poster</label>
          <div className="upload">{image?<img src={image} alt="Poster"/>:<span>سيظهر البوستر هنا بعد إرساله من المنشئ</span>}</div>
          <label>Caption</label><textarea value={caption} onChange={e=>setCaption(e.target.value)} placeholder="اكتب الكابشن هنا..."/>
          <label>Platforms</label>
          <div className="platforms">{(["Facebook","Instagram","TikTok","X"] as Platform[]).map(p=><button key={p} className={platforms.includes(p)?"selected":""} onClick={()=>toggle(p)}>{p}</button>)}</div>
          <button className="primary" onClick={()=>save("scheduled")}>Schedule / Publish</button>
          <button className="secondary" onClick={()=>save("draft")}>حفظ كمسودة</button>
        </div>
      </section>

      {!!posts.length&&<section className="card all"><h2>كل المحتوى</h2>{posts.map(p=><div className="row" key={p.id}><div><b>{p.title}</b><span>{p.caption}</span></div><button onClick={()=>remove(p.id)}>حذف</button></div>)}</section>}
    </main>
  </div>;
}

function Stat({label,value}:{label:string;value:number}){return <div className="stat"><span>{label}</span><strong>{value}</strong></div>}
