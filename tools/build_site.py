#!/usr/bin/env python3
"""Build public static pages from the owner-reviewed public data. No credentials."""
from pathlib import Path
import html, json, re, shutil
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / 'site'
ORIGIN = 'https://turkiahmet.github.io'
LANGS = ('ar', 'tr', 'en')
VERIFY = 'CykuwbYrI6LnpZY7fQTVZyqWvxjNmVtmJlBKKVKBy5U'
MASTER = 'sharh-al-tawilat-2021'
DICLE_HANDLE = 'https://hdl.handle.net/11468/7410'
DICLE_PDF = 'https://acikerisim.dicle.edu.tr/bitstreams/c2d80d11-cfcf-4ea4-919c-2ed97ad9d1b9/download'
DATA = json.loads((ROOT / 'content/site-data.json').read_text())
ABSTRACTS = json.loads((ROOT / 'content/abstracts.json').read_text())
E = lambda s: html.escape(str(s or ''), quote=True)
LABEL = {
 'ar': {'home':'الرئيسية','cv':'السيرة العلمية','download':'تنزيل السيرة العلمية PDF','education':'التعليم الجامعي','interests':'مجالات البحث','experience':'خبرات علمية وتعليمية','works':'الأعمال العلمية','ongoing':'البحث الجاري','details':'قراءة بيانات العمل','source':'السجل الرسمي','contact':'للتواصل','abstract':'المستخلص الأصلي للرسالة — ٢٠٢١','original_note':'نص المستخلص كما ورد في رسالة سنة ٢٠٢١؛ يحفظ عبارات المؤلف في سياقها التاريخي.','public_cv':'سيرة علمية عامة','updated':'آخر تحديث: ٥ نوفمبر ٢٠٢٦','types':{'masters_thesis':'رسالة ماجستير','doctoral_thesis':'بحث دكتوراه','article':'مقال علمي','other':'عمل علمي'},'status':{'published':'منجز / منشور','in_progress':'قيد الإعداد'}},
 'tr': {'home':'Ana sayfa','cv':'Akademik özgeçmiş','download':'Akademik özgeçmişi indir (PDF)','education':'Akademik eğitim','interests':'Araştırma alanları','experience':'Akademik ve öğretim deneyimi','works':'Akademik çalışmalar','ongoing':'Devam eden araştırma','details':'Çalışmanın ayrıntıları','source':'Resmî kayıt','contact':'İletişim','abstract':'Tezin özgün özeti — 2021','original_note':'Özet, 2021 tarihli tezdeki özgün ifadeleriyle ve tarihsel bağlamıyla sunulmuştur.','public_cv':'Akademik özgeçmiş','updated':'Son güncelleme: 5 Kasım 2026','types':{'masters_thesis':'Yüksek lisans tezi','doctoral_thesis':'Doktora araştırması','article':'Akademik makale','other':'Akademik çalışma'},'status':{'published':'Tamamlanmış / yayımlanmış','in_progress':'Devam ediyor'}},
 'en': {'home':'Home','cv':'Academic CV','download':'Download academic CV (PDF)','education':'Academic education','interests':'Research interests','experience':'Academic and teaching experience','works':'Academic work','ongoing':'Current research','details':'Explore the work','source':'Official record','contact':'Contact','abstract':'Original thesis abstract — 2021','original_note':'The original wording of the 2021 thesis abstract is retained in its historical context.','public_cv':'Academic CV','updated':'Updated: 5 November 2026','types':{'masters_thesis':'Master’s thesis','doctoral_thesis':'Doctoral research','article':'Academic article','other':'Academic work'},'status':{'published':'Completed / published','in_progress':'In progress'}}}

CV = {
 'ar': {'education':[('قيد الإعداد','دكتوراه في التفسير','جامعة بايبورت، تركيا'),('٢٠٢١','ماجستير في التفسير','جامعة دجلة، تركيا'),('٢٠١٥','دراسة تمهيدية للماجستير في العقائد والأديان','جامعة دمشق، سورية'),('٢٠١٤','دبلوم التأهيل التربوي','جامعة حلب، سورية'),('٢٠١١','إجازة في الشريعة، قسم أصول الدين','جامعة حلب، سورية')], 'experience':['تدريس التربية الإسلامية والقرآن الكريم في سورية وتركيا.','تدريس العربية للناطقين بغيرها.','خبرة في تحقيق المخطوطات ودراسة التراث التفسيري.'],'languages':'العربية؛ والتركية بمستوى C1 وفق شهادة الكفاءة اللغوية من جامعة دجلة (٢٠١٨).','languages_label':'اللغات'},
 'tr': {'education':[('Devam ediyor','Tefsir alanında doktora','Bayburt Üniversitesi, Türkiye'),('2021','Tefsir alanında yüksek lisans','Dicle Üniversitesi, Türkiye'),('2015','Akaid ve dinler alanında yüksek lisans hazırlık öğrenimi','Şam Üniversitesi, Suriye'),('2014','Pedagojik formasyon diploması','Halep Üniversitesi, Suriye'),('2011','Şeriat lisansı, Usûlü’d-dîn bölümü','Halep Üniversitesi, Suriye')], 'experience':['Suriye ve Türkiye’de din eğitimi ve Kur’an öğretimi.','Ana dili Arapça olmayanlara Arapça öğretimi.','Yazma eserlerin tahkiki ve tefsir mirası üzerine araştırma.'],'languages':'Arapça; Türkçe: Dicle Üniversitesi dil yeterlik belgesine göre C1 (2018).','languages_label':'Diller'},
 'en': {'education':[('In progress','Doctoral studies in tafsir','Bayburt University, Türkiye'),('2021','Master’s degree in tafsir','Dicle University, Türkiye'),('2015','Preparatory postgraduate studies in theology and religions','Damascus University, Syria'),('2014','Diploma in pedagogical qualification','University of Aleppo, Syria'),('2011','Bachelor’s degree in Sharia, Uṣūl al-Dīn','University of Aleppo, Syria')], 'experience':['Teaching Islamic education and the Qur’an in Syria and Türkiye.','Teaching Arabic to speakers of other languages.','Research in manuscript editing and the exegetical heritage.'],'languages':'Arabic; Turkish: C1, as documented by the Dicle University language proficiency certificate (2018).','languages_label':'Languages'}}

def safe_url(value):
    if not value: return ''
    value = str(value).strip()
    u = urlparse(value)
    if u.scheme != 'https' or not u.netloc: raise ValueError('Public links must use https')
    return value

def validate():
    if DATA.get('schemaVersion') != 1: raise ValueError('Unsupported data schema')
    for lang in LANGS:
        p = DATA['profile'][lang]
        for field in ('displayName','role','tagline','bio'):
            if not isinstance(p.get(field),str) or len(p[field]) > 6000: raise ValueError('Invalid profile field')
        if not isinstance(p.get('interests'),list): raise ValueError('Invalid interests')
    ids = set()
    for w in DATA['works']:
        if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,99}',w['id']) or w['id'] in ids: raise ValueError('Invalid work id')
        ids.add(w['id'])
        if w.get('status') != 'published': raise ValueError('Only officially published works may enter the public build')
        if w.get('type') not in LABEL['en']['types']: raise ValueError('Invalid work type')
        for l in LANGS:
            if not isinstance(w['title'].get(l),str) or not w['title'][l].strip(): raise ValueError('Every public work needs three titles')
            if not isinstance(w['summary'].get(l),str): raise ValueError('Invalid summary')
        for k in ('officialUrl','imageUrl','videoUrl'):
            if w.get(k): safe_url(w[k])
    if MASTER not in ids: raise ValueError('Preserve the verified master record')

def langnav(lang, path=''):
    return '<nav class="lang-nav" aria-label="Language">' + ''.join('<a href="/'+l+'/'+path+'" lang="'+l+'" hreflang="'+l+'" dir="'+('rtl' if l=='ar' else 'ltr')+'"'+(' aria-current="page"' if l==lang else '')+'>'+{'ar':'العربية','tr':'Türkçe','en':'English'}[l]+'</a>' for l in LANGS) + '</nav>'

def full_description(lang):
    p=DATA['profile'][lang]
    return p['role'] + ('، ' if lang=='ar' else '. ') + p['tagline']

def transform_common(text, lang):
    p=DATA['profile'][lang]
    text=re.sub(r'<meta property="og:site_name" content="[^"]*">','<meta property="og:site_name" content="'+E(p['displayName'])+'">',text)
    def ld(m):
        obj=json.loads(m.group(1))
        for node in obj.get('@graph',[]):
            if node.get('@type')=='Person':
                node.update(name=p['displayName'],description=full_description(lang),knowsAbout=DATA['profile']['en']['interests'])
            if node.get('@type')=='WebSite':
                node.update(name=DATA['profile']['ar']['displayName'],alternateName=[DATA['profile'][l]['displayName'] for l in ('tr','en')])
            if node.get('@type')=='ProfilePage': node['name']=p['displayName']
        return '<script type="application/ld+json">'+json.dumps(obj,ensure_ascii=False).replace('<','\\u003c')+'</script>'
    text=re.sub(r'<script type="application/ld\+json">(.*?)</script>',ld,text,flags=re.S)
    text=text.replace('</head>','<meta name="google-site-verification" content="'+VERIFY+'">\n</head>')
    text=text.replace('</body>','<script src="/assets/services.js?v=20261105-4" defer></script>\n</body>')
    text=text.replace('v=20261105"','v=20261105-2"')
    text=re.sub(r'(<div class="footer-profile"><p>).*?(</p>)',lambda m:m[1]+E(p['displayName'])+' · '+E({'ar':'العلوم الإسلامية','tr':'İslâmî ilimler','en':'Islamic sciences'}[lang])+m[2],text,count=1)
    return text

def card(w,lang):
    label=LABEL[lang]; year=w.get('year'); route='/'+lang+'/research/'+w['id']+'/'
    meta='<span class="work-kind">'+E(label['types'][w['type']])+'</span>'
    if year: meta+='<time datetime="'+E(year)+'">'+E(year)+'</time>'
    if w['status']=='in_progress': meta+='<span>'+E(label['status']['in_progress'])+'</span>'
    return '<article class="work-card"><div class="work-topline">'+meta+'</div><h3><a href="'+route+'">'+E(w['title'][lang])+'</a></h3><p>'+E(w['summary'][lang])+'</p><a class="text-link" href="'+route+'">'+E(label['details'])+' <span class="arrow" aria-hidden="true">→</span></a></article>'

def home(lang):
    p=DATA['profile'][lang]; t=(ROOT/'templates'/('home-'+lang+'.html')).read_text(); lab=LABEL[lang]
    t=re.sub(r'<title>.*?</title>','<title>'+E(p['displayName'])+'</title>',t)
    for attr in ('name="description"','property="og:description"'):
        t=re.sub(r'<meta '+attr+r' content="[^"]*">','<meta '+attr+' content="'+E(full_description(lang)+' '+p['bio'])+'">',t)
    t=re.sub(r'<meta property="og:title" content="[^"]*">','<meta property="og:title" content="'+E(p['displayName'])+'">',t)
    t=re.sub(r'<p class="eyebrow">.*?</p>','<p class="eyebrow">'+E({'ar':'العلوم الإسلامية','tr':'İslâmî ilimler','en':'Islamic sciences'}[lang])+'</p>',t,count=1)
    t=re.sub(r'<p class="role">.*?</p>','<p class="role">'+E(p['role'])+'</p><p class="research-tagline">'+E(p['tagline'])+'</p>',t,count=1)
    t=re.sub(r'<p class="bio">.*?</p>','<p class="bio">'+E(p['bio'])+'</p>',t,count=1)
    t=re.sub(r'(<aside class="research-focus">.*?<ul>).*?(</ul>)',lambda m:m[1]+''.join('<li>'+E(x)+'</li>' for x in p['interests'])+m[2],t,count=1,flags=re.S)
    for status,key in (('published','works'),('in_progress','ongoing')):
        section='<section class="section" aria-labelledby="'+key+'"><div class="section-heading"><h2 id="'+key+'">'+E(lab[key])+'</h2></div><div class="works-list">'+''.join(card(w,lang) for w in DATA['works'] if w['status']==status)+'</div></section>'
        t=re.sub(r'<section class="section" aria-labelledby="'+key+r'">.*?</section>',lambda m:section,t,count=1,flags=re.S)
    t=t.replace('<a href="#education">','<a href="/'+lang+'/cv/">'+E(lab['cv'])+'</a><a href="#education">',1)
    t=t.replace('</main>','<section class="section" aria-labelledby="cv-download"><h2 id="cv-download">'+E(lab['cv'])+'</h2><p><a href="/'+lang+'/cv/">'+E(lab['public_cv'])+'</a> · <a href="/downloads/turki-ahmet-cv-'+lang+'.pdf" download>'+E(lab['download'])+'</a></p></section></main>',1)
    t=t.replace('<footer id="contact"','<div class="container" data-contact-form></div>\n<footer id="contact"',1)
    t=re.sub(r'<section class="section" aria-labelledby="ongoing">.*?</section>','',t,count=1,flags=re.S)
    return transform_common(t,lang)

def master(lang):
    t=(ROOT/'templates'/('master-'+lang+'.html')).read_text(); lab=LABEL[lang]
    repository_labels={
        'ar':('سجل الرسالة في مستودع جامعة دجلة','النسخة الكاملة في مستودع جامعة دجلة (PDF)','السجل المؤسسي ذو المعرّف الدائم 11468/7410؛ إتاحة وصول مفتوح في ٢٧ أغسطس ٢٠٢١.'),
        'tr':('Dicle Üniversitesi kurumsal arşiv kaydı','Dicle Üniversitesi arşivinde tam metin (PDF)','Kalıcı kayıt: 11468/7410. Açık erişime sunulma tarihi: 27 Ağustos 2021.'),
        'en':('Dicle University institutional repository record','Full text in the Dicle University repository (PDF)','Persistent record: 11468/7410. Made available as open access on 27 August 2021.')}
    record_label,pdf_label,note=repository_labels[lang]
    repository_links='<li><a href="'+DICLE_HANDLE+'">'+E(record_label)+'</a><small>'+E(note)+'</small></li><li><a href="'+DICLE_PDF+'" type="application/pdf">'+E(pdf_label)+'</a></li>'
    t=t.replace('<ul class="source-links">','<ul class="source-links">'+repository_links,1)
    def institution_metadata(match):
        obj=json.loads(match.group(1))
        for node in obj.get('@graph',[]):
            if node.get('@type')=='Thesis':
                previous=node.get('sameAs',[])
                previous=[previous] if isinstance(previous,str) else previous
                node['sameAs']=list(dict.fromkeys(previous+[DICLE_HANDLE]))
                identifiers=node.get('identifier',[])
                identifiers=[identifiers] if isinstance(identifiers,dict) else identifiers
                node['identifier']=identifiers+[{'@type':'PropertyValue','propertyID':'Handle','value':'11468/7410','url':DICLE_HANDLE}]
                node['encoding']={'@type':'MediaObject','encodingFormat':'application/pdf','contentUrl':DICLE_PDF}
                node['isAccessibleForFree']=True
        return '<script type="application/ld+json">'+json.dumps(obj,ensure_ascii=False).replace('<','\\u003c')+'</script>'
    t=re.sub(r'<script type="application/ld\+json">(.*?)</script>',institution_metadata,t,flags=re.S)
    if lang in ('tr','en'):
        key={'tr':'turkish','en':'english'}[lang]; a=ABSTRACTS[key]
        block='<section aria-labelledby="original-abstract"><h2 id="original-abstract">'+E(lab['abstract'])+'</h2><p>'+E(a['text'])+'</p><p class="small-note">'+E(lab['original_note'])+'</p></section>\n'
        t=t.replace('<section aria-labelledby="keywords">',block+'<section aria-labelledby="keywords">',1)
    else:
        block='<section aria-labelledby="original-abstract"><h2 id="original-abstract">المستخلصان الأصليان للرسالة — ٢٠٢١</h2><p>يتاح النص الأصلي للمستخلص التركي والإنجليزي في صفحتي العمل المقابلتين. النص التعريفي العربي أعلاه وصف محرر للعمل.</p><p><a href="/tr/research/'+MASTER+'/#original-abstract">المستخلص التركي</a> · <a href="/en/research/'+MASTER+'/#original-abstract">المستخلص الإنجليزي</a></p></section>\n'
        t=t.replace('<section aria-labelledby="keywords">',block+'<section aria-labelledby="keywords">',1)
    t=t.replace('<meta name="citation_date" content="2021">','<meta name="citation_date" content="2021">\n<meta name="citation_publication_date" content="2021">')
    return transform_common(t,lang)

def page_shell(lang,path,title,description,content,graph=None):
    p=DATA['profile'][lang]; lab=LABEL[lang]; url=ORIGIN+'/'+lang+'/'+path
    alternates=''.join('<link rel="alternate" hreflang="'+l+'" href="'+ORIGIN+'/'+l+'/'+path+'">' for l in LANGS)
    obj={'@context':'https://schema.org','@graph':[{'@type':'Person','@id':ORIGIN+'/#person','name':p['displayName'],'alternateName':['تركي الاحمد','تركي الأحمد','Türki Ahmet','Turki Ahmet','Turki Al Ahmad'],'description':full_description(lang),'url':ORIGIN+'/en/','sameAs':['https://orcid.org/0000-0002-7936-3626'],'email':'turkiahmet26@gmail.com','knowsAbout':DATA['profile']['en']['interests']},{'@type':'WebSite','@id':ORIGIN+'/#website','name':DATA['profile']['ar']['displayName'],'alternateName':['Türki Ahmet','Turki Al Ahmad'],'url':ORIGIN+'/'},{'@type':'WebPage','@id':url+'#webpage','url':url,'name':title,'inLanguage':lang,'isPartOf':{'@id':ORIGIN+'/#website'}}]+(graph or [])}
    t='<!doctype html>\n<html lang="'+lang+'" dir="'+('rtl' if lang=='ar' else 'ltr')+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>'+E(title)+'</title><meta name="description" content="'+E(description)+'"><meta name="author" content="'+E(p['displayName'])+'"><meta name="robots" content="index,follow"><link rel="canonical" href="'+url+'">'+alternates+'<link rel="alternate" hreflang="x-default" href="'+ORIGIN+'/ar/'+path+'"><meta property="og:title" content="'+E(title)+'"><meta property="og:description" content="'+E(description)+'"><meta property="og:url" content="'+url+'"><meta property="og:site_name" content="'+E(p['displayName'])+'"><meta name="twitter:card" content="summary"><link rel="icon" href="/assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/style.css?v=20261105-2"><script type="application/ld+json">'+json.dumps(obj,ensure_ascii=False).replace('<','\\u003c')+'</script><meta name="google-site-verification" content="'+VERIFY+'"></head><body><a class="skip" href="#main">'+E({'ar':'انتقل إلى المحتوى','tr':'İçeriğe geç','en':'Skip to content'}[lang])+'</a><header class="site-header"><div class="container header-inner"><a class="brand" href="/'+lang+'/"><span class="brand-mark" aria-hidden="true">TA</span><span class="brand-name">'+E(p['displayName'])+'</span></a>'+langnav(lang,path)+'</div></header><main id="main" class="container"><nav class="breadcrumb"><a href="/'+lang+'/">'+E(lab['home'])+'</a></nav>'+content+'</main><footer class="site-footer"><div class="container footer-inner"><p>'+E(p['displayName'])+'</p><p>'+E(lab['contact'])+': <a href="mailto:turkiahmet26@gmail.com">turkiahmet26@gmail.com</a></p>'+langnav(lang)+'</div></footer><script src="/assets/services.js?v=20261105-4" defer></script></body></html>\n'
    return t

def cv(lang):
    p=DATA['profile'][lang]; c=CV[lang]; lab=LABEL[lang]
    content='<header class="work-header"><p class="eyebrow">'+E(lab['public_cv'])+'</p><h1>'+E(p['displayName'])+'</h1><p class="work-deck">'+E(full_description(lang))+'</p><p><a href="/downloads/turki-ahmet-cv-'+lang+'.pdf" download>'+E(lab['download'])+'</a></p></header><section class="section"><h2>'+E(lab['education'])+'</h2><div class="education-grid">'+''.join('<article class="education-item"><span class="date">'+E(date)+'</span><h3>'+E(degree)+'</h3><p>'+E(school)+'</p></article>' for date,degree,school in c['education'])+'</div></section><section class="section"><h2>'+E(lab['interests'])+'</h2><ul>'+''.join('<li>'+E(i)+'</li>' for i in p['interests'])+'</ul></section><section class="section"><h2>'+E(lab['experience'])+'</h2><ul>'+''.join('<li>'+E(i)+'</li>' for i in c['experience'])+'</ul></section><section class="section"><h2>'+E(c['languages_label'])+'</h2><p>'+E(c['languages'])+'</p></section><section class="section"><h2>'+E(lab['works'])+'</h2><div class="works-list">'+''.join(card(w,lang) for w in DATA['works'])+'</div></section><p class="small-note">'+E(lab['updated'])+'</p>'
    return page_shell(lang,'cv/',lab['cv']+' | '+p['displayName'],full_description(lang),content)

def generic(w,lang):
    p=DATA['profile'][lang]; lab=LABEL[lang]; title=w['title'][lang]; path='research/'+w['id']+'/'
    content='<header class="work-header"><p class="eyebrow">'+E(lab['types'][w['type']])+' · '+E(lab['status'][w['status']])+'</p><h1>'+E(title)+'</h1><p class="work-deck">'+E(w['summary'][lang])+'</p></header><section class="section"><h2>'+E(lab['interests'])+'</h2><ul class="keywords">'+''.join('<li>'+E(k)+'</li>' for k in w.get('keywords',{}).get(lang,[]))+'</ul></section>'
    if w.get('officialUrl'): content+='<section class="section"><h2>'+E(lab['source'])+'</h2><p><a href="'+E(safe_url(w['officialUrl']))+'">'+E(lab['source'])+'</a></p></section>'
    if w.get('imageUrl'): content+='<figure class="work-figure"><img src="'+E(safe_url(w['imageUrl']))+'" alt="'+E(title)+'" loading="lazy"></figure>'
    if w.get('videoUrl'): content+='<p><a href="'+E(safe_url(w['videoUrl']))+'">'+E({'ar':'مشاهدة المادة المرئية','tr':'Videoyu izle','en':'View video'}[lang])+'</a></p>'
    node={'@type':'Thesis' if w['type'].endswith('_thesis') else 'CreativeWork','@id':ORIGIN+'/'+lang+'/'+path+'#work','name':title,'description':w['summary'][lang],'url':ORIGIN+'/'+lang+'/'+path,'author':{'@id':ORIGIN+'/#person'},'creativeWorkStatus':w['status'],'inLanguage':lang}
    if w.get('year') and w['status']=='published': node['datePublished']=str(w['year'])
    if w.get('officialUrl'): node['sameAs']=w['officialUrl']
    return page_shell(lang,path,title+' | '+p['displayName'],w['summary'][lang],content,[node]).replace('</head>','<meta name="academic-generated-route" content="1"></head>')

def write(path,text):
    path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text)

def main():
    validate(); routes=[]
    public_ids={w['id'] for w in DATA['works']}
    # Remove only generator-owned routes that the owner has unpublished.
    for lang in LANGS:
        research=SITE/lang/'research'
        if research.exists():
            for directory in research.iterdir():
                page=directory/'index.html'
                if directory.is_dir() and directory.name not in public_ids and page.is_file() and 'name="academic-generated-route" content="1"' in page.read_text():shutil.rmtree(directory)
    for lang in LANGS:
        write(SITE/lang/'index.html',home(lang)); routes.append('/'+lang+'/')
        write(SITE/lang/'cv/index.html',cv(lang));routes.append('/'+lang+'/cv/')
        for w in DATA['works']:
            text=master(lang) if w['id']==MASTER else generic(w,lang)
            route='/'+lang+'/research/'+w['id']+'/'
            write(SITE/route.lstrip('/')/'index.html',text); routes.append(route)
    write(SITE/'index.html',(SITE/'ar/index.html').read_text())
    write(SITE/'sitemap.xml','<?xml version="1.0" encoding="utf-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+''.join('  <url><loc>'+ORIGIN+r+'</loc></url>\n' for r in routes)+'</urlset>\n')
    write(SITE/'robots.txt','User-agent: *\nAllow: /\nSitemap: '+ORIGIN+'/sitemap.xml\n')
    print('Built '+str(len(routes))+' distinct public pages; existing thesis citations preserved.')

if __name__=='__main__': main()
