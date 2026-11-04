#!/usr/bin/env python3
"""Generate public CV snapshots from the same public source as the HTML pages."""
from pathlib import Path
from html import escape
import json, sys
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Flowable, KeepTogether
import arabic_reshaper
from bidi.algorithm import get_display
from build_site import DATA, CV, LABEL, ROOT, ORIGIN

AR='/usr/share/fonts/truetype/noto/NotoNaskhArabic-Regular.ttf'
ARB='/usr/share/fonts/truetype/noto/NotoNaskhArabic-Bold.ttf'
LAT='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
LATB='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
# The runtime fonts are used locally; CI may provide equivalent local Noto/DejaVu fonts.
for name,path in [('Naskh',AR),('NaskhBold',ARB),('Latin',LAT),('LatinBold',LATB)]:pdfmetrics.registerFont(TTFont(name,path))

class RTLText(Flowable):
    def __init__(self,text,size=12,leading=18,bold=False,color='#303c36'):
        super().__init__();self.text=text;self.size=size;self.leading=leading;self.font='NaskhBold' if bold else 'Naskh';self.color=colors.HexColor(color)
    def runs(self,text):
        visual=get_display(arabic_reshaper.reshape(text));out=[]
        face=pdfmetrics.getFont(self.font).face
        for char in visual:
            font=self.font if ord(char) in face.charToGlyph else ('LatinBold' if self.font=='NaskhBold' else 'Latin')
            if out and out[-1][0]==font:out[-1]=(font,out[-1][1]+char)
            else:out.append((font,char))
        return out
    def length(self,text):
        return sum(pdfmetrics.stringWidth(t,f,self.size) for f,t in self.runs(text))
    def wrap(self,width,height):
        self.width=width;self.lines=[]
        for para in self.text.split('\n'):
            line=''
            for word in para.split():
                test=(line+' '+word).strip()
                if line and self.length(test)>width:self.lines.append(line);line=word
                else:line=test
            self.lines.append(line)
        self.height=len(self.lines)*self.leading+3;return width,self.height
    def draw(self):
        c=self.canv;c.setFillColor(self.color);c.setFont(self.font,self.size)
        for n,line in enumerate(self.lines):
            x=self.width-self.length(line);y=self.height-(n+1)*self.leading+4
            for font,run in self.runs(line):
                c.setFont(font,self.size);c.drawString(x,y,run);x+=pdfmetrics.stringWidth(run,font,self.size)

def create(lang):
    p=DATA['profile'][lang];c=CV[lang];lab=LABEL[lang];is_ar=lang=='ar'
    out=ROOT/'site/downloads'/('turki-ahmet-cv-'+lang+'.pdf');out.parent.mkdir(parents=True,exist_ok=True)
    doc=SimpleDocTemplate(str(out),pagesize=A4,leftMargin=44,rightMargin=44,topMargin=37,bottomMargin=38,title=p['displayName']+' - '+lab['cv'],author=p['displayName'])
    normal=ParagraphStyle('body',fontName='Latin',fontSize=9.8,leading=14.6,spaceAfter=4,textColor=colors.HexColor('#303c36'))
    title=ParagraphStyle('title',parent=normal,fontName='LatinBold',fontSize=23,leading=29,textColor=colors.HexColor('#193d33'),spaceAfter=9)
    heading=ParagraphStyle('heading',parent=normal,fontName='LatinBold',fontSize=11,leading=17,spaceBefore=11,spaceAfter=6,textColor=colors.HexColor('#193d33'))
    story=[]
    def text(t,kind='body'):
        if is_ar:return RTLText(t,24 if kind=='title' else 14 if kind=='heading' else 11.7,31 if kind=='title' else 21 if kind=='heading' else 17.7,kind!='body','#193d33' if kind!='body' else '#303c36')
        return Paragraph(escape(t),{'body':normal,'title':title,'heading':heading}[kind])
    story += [text(p['displayName'],'title'),text(p['role']),text(p['tagline']),Spacer(1,8)]
    # Keep direct links readable in all three PDFs without a private telephone or address.
    for t,u in [('turkiahmet26@gmail.com','mailto:turkiahmet26@gmail.com'),('ORCID: 0000-0002-7936-3626','https://orcid.org/0000-0002-7936-3626'),('turkiahmet.github.io',ORIGIN+'/'+lang+'/')]:
        story.append(Paragraph('<a href="'+u+'" color="#193d33">'+t+'</a>',normal))
    story.append(text(lab['education'],'heading'))
    for date,degree,school in c['education']:story.append(text(date+' | '+degree+' - '+school))
    story += [text(lab['interests'],'heading'),text(' · '.join(p['interests'])),text(lab['experience'],'heading')]
    for line in c['experience']:story.append(text(line))
    story += [text(c['languages_label'],'heading'),text(c['languages']),text(lab['works'],'heading')]
    for work in DATA['works']:
        title_text=work['title'][lang]
        kind=lab['types'][work['type']];date=str(work.get('year') or lab['status']['in_progress'])
        story += [text(kind+' - '+date),text(title_text)]
    story += [Spacer(1,10),text(lab['updated'])]
    def footer(canvas,doc):
        canvas.setStrokeColor(colors.HexColor('#d9dfd5'));canvas.line(44,30,A4[0]-44,30);canvas.setFont('Latin',8);canvas.setFillColor(colors.HexColor('#647269'));canvas.drawString(44,18,'turkiahmet.github.io');canvas.drawRightString(A4[0]-44,18,str(doc.page))
    doc.build(story,onFirstPage=footer,onLaterPages=footer)
    print(out)

if __name__=='__main__':
    for lang in ('ar','tr','en'):create(lang)
