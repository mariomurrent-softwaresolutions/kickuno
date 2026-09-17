"use client";

import { useEffect, useRef, useState, type SyntheticEvent, type TouchEvent } from "react";

const galleryImages = [
  "Simulator Screenshot - iPhone 14 Plus - 2026-09-16 at 17.33.54.png",
  "Simulator Screenshot - iPhone 14 Plus - 2026-09-16 at 17.34.25.png",
  "Simulator Screenshot - iPhone 14 Plus - 2026-09-16 at 17.37.01.png",
  "Simulator Screenshot - iPhone 14 Plus - 2026-09-16 at 17.37.09.png",
  "Simulator Screenshot - iPhone 14 Plus - 2026-09-16 at 17.37.28.png",
  "Simulator Screenshot - iPhone 14 Plus - 2026-09-16 at 17.37.31.png",
  "Simulator Screenshot - iPhone 14 Plus - 2026-09-16 at 17.37.51.png",
  "Simulator Screenshot - iPhone 14 Plus - 2026-09-16 at 17.37.59.png",
  "Simulator Screenshot - iPhone 14 Plus - 2026-09-16 at 17.38.04.png",
].map((fileName, index) => ({
  src: `/screenshots/${encodeURIComponent(fileName)}`,
  alt: `Kickuno App-Screenshot ${index + 1}`,
  label: `Screen ${index + 1}`,
  caption: `App-Ansicht ${index + 1}`,
}));

const fixtureFeatures = [
  { number: "01", title: "Termine & Zusagen", text: "Neue Termine in Sekunden anlegen - mit Halle, Uhrzeit und optionaler woechentlicher Wiederholung. Jeder sagt per Tipp zu oder ab." },
  { number: "02", title: "Faire Teams, automatisch", text: "Ein Tipp genuegt: Kickuno verteilt zugesagte Spieler nach Staerke auf zwei ausgeglichene Teams. Manuelles Verschieben bleibt jederzeit moeglich." },
  { number: "03", title: "Ergebnisse festhalten", text: "Tore, Eigentore und Spieler des Abends in Sekunden erfassen. Der Spielstand wird live berechnet und fuer alle sichtbar gespeichert." },
];

const groupFeatures = [
  { number: "04", title: "Statistiken, die Spass machen", text: "Torschuetzenliste, Siegquote, Formkurve und MVP-Titel - pro Saison und ueber die gesamte Vereinsgeschichte." },
  { number: "05", title: "Saisons & Vereinsgeschichte", text: "Saisons starten und abschliessen, trotzdem jederzeit auf vergangene Spielzeiten inklusive aller Ergebnisse zugreifen." },
  { number: "06", title: "Eure Gruppe, eure Regeln", text: "Per Einladungscode gruenden oder beitreten, Rollen vergeben, Hallen verwalten und sogar die Teamnamen anpassen." },
];

function LogoMark({ large = false }: { large?: boolean }) {
  return <img className={`logoMark ${large ? "large" : ""}`} src="/kickuno-icon.png" alt="" aria-hidden="true" />;
}

function ScreenshotImage({ src, alt, onClick }: { src: string; alt: string; onClick?: () => void }) {
  const [failed, setFailed] = useState(false);

  function handleError(event: SyntheticEvent<HTMLImageElement>) {
    event.currentTarget.style.display = "none";
    setFailed(true);
  }

  return (
    <>
      <img src={src} alt={alt} onClick={onClick} onError={handleError} style={{ display: failed ? "none" : undefined }} />
      {failed && <div className="screenshotFallback">Screenshot folgt</div>}
    </>
  );
}

export default function HomeGallery() {
  const [activeSlide, setActiveSlide] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [lightboxZoom, setLightboxZoom] = useState(1);
  const lightboxTouchStartX = useRef<number | null>(null);
  const sliderTouchStartX = useRef<number | null>(null);

  const activeImage = lightboxIndex === null ? null : galleryImages[lightboxIndex];

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLightboxIndex(null);
        setLightboxZoom(1);
      }

      if (event.key === "ArrowRight") {
        if (lightboxIndex === null) setActiveSlide((current) => (current + 1) % galleryImages.length);
        else setLightboxIndex((current) => (current === null ? 0 : (current + 1) % galleryImages.length));
      }

      if (event.key === "ArrowLeft") {
        if (lightboxIndex === null) setActiveSlide((current) => (current - 1 + galleryImages.length) % galleryImages.length);
        else setLightboxIndex((current) => (current === null ? 0 : (current - 1 + galleryImages.length) % galleryImages.length));
      }

      if ((event.key === "+" || event.key === "=") && lightboxIndex !== null) {
        setLightboxZoom((current) => Math.min(3, current + 0.25));
      }

      if ((event.key === "-" || event.key === "_") && lightboxIndex !== null) {
        setLightboxZoom((current) => Math.max(1, current - 0.25));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lightboxIndex]);

  const goToPrevious = () => {
    setLightboxZoom(1);
    setLightboxIndex((current) => (current === null ? 0 : (current - 1 + galleryImages.length) % galleryImages.length));
  };

  const goToNext = () => {
    setLightboxZoom(1);
    setLightboxIndex((current) => (current === null ? 0 : (current + 1) % galleryImages.length));
  };

  const goToPreviousSlide = () => {
    setActiveSlide((current) => (current - 1 + galleryImages.length) % galleryImages.length);
  };

  const goToNextSlide = () => {
    setActiveSlide((current) => (current + 1) % galleryImages.length);
  };

  const openLightbox = (index: number) => {
    setLightboxIndex(index);
    setLightboxZoom(1);
  };

  const handleLightboxTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    lightboxTouchStartX.current = event.touches[0].clientX;
  };

  const handleLightboxTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    if (lightboxTouchStartX.current === null) return;

    const deltaX = event.changedTouches[0].clientX - lightboxTouchStartX.current;
    if (Math.abs(deltaX) > 50) {
      if (deltaX < 0) goToNext();
      else goToPrevious();
    }

    lightboxTouchStartX.current = null;
  };

  const handleSliderTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    sliderTouchStartX.current = event.touches[0].clientX;
  };

  const handleSliderTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    if (sliderTouchStartX.current === null) return;

    const deltaX = event.changedTouches[0].clientX - sliderTouchStartX.current;
    if (Math.abs(deltaX) > 40) {
      if (deltaX < 0) goToNextSlide();
      else goToPreviousSlide();
    }

    sliderTouchStartX.current = null;
  };

  return (
    <main>
      {activeImage && (
        <div className="lightbox" role="dialog" aria-modal="true" onClick={() => { setLightboxIndex(null); setLightboxZoom(1); }}>
          <button type="button" className="lightboxClose" aria-label="Vorschau schliessen" onClick={() => { setLightboxIndex(null); setLightboxZoom(1); }}>
            x
          </button>
          <div className="lightboxNav lightboxPrev" aria-label="Vorheriges Bild" onClick={(event) => { event.stopPropagation(); goToPrevious(); }}>
            {"<"}
          </div>
          <div className="lightboxNav lightboxNext" aria-label="Naechstes Bild" onClick={(event) => { event.stopPropagation(); goToNext(); }}>
            {">"}
          </div>
          <div className="lightboxViewport" onTouchStart={handleLightboxTouchStart} onTouchEnd={handleLightboxTouchEnd} onClick={(event) => event.stopPropagation()}>
            <div className="lightboxImageWrap">
              <img className="lightboxImage" src={activeImage.src} alt={activeImage.alt} style={{ transform: `scale(${lightboxZoom})` }} />
            </div>
            <div className="lightboxTools" aria-label="Zoom Steuerung">
              <button type="button" onClick={() => setLightboxZoom((current) => Math.max(1, current - 0.25))}>-</button>
              <button type="button" onClick={() => setLightboxZoom(1)}>100%</button>
              <button type="button" onClick={() => setLightboxZoom((current) => Math.min(3, current + 0.25))}>+</button>
            </div>
            <div className="lightboxMeta">
              <span>{activeImage.label}</span>
              <strong>{lightboxIndex !== null ? `${lightboxIndex + 1} / ${galleryImages.length}` : ""}</strong>
            </div>
          </div>
        </div>
      )}

      <nav className="nav shell" aria-label="Hauptnavigation">
        <a className="brand" href="#top" aria-label="Kickuno Start">
          <LogoMark />
          <span className="wordmark">Kick<em>u</em>no</span>
        </a>
        <div className="navLinks">
          <a href="#funktionen">Funktionen</a>
          <a href="#screens">App</a>
          <a href="#gruppe">Eure Gruppe</a>
        </div>
        <span className="navCta comingSoon"><i /> Bald fuer iOS &amp; Android</span>
      </nav>

      <section className="hero shell" id="top">
        <div className="heroCopy">
          <p className="eyebrow"><span /> Fuer eure feste Fussballrunde</p>
          <h1>Teams. Termine.<br /><em>Tore.</em></h1>
          <p className="lede">Kickuno buendelt Zusagen, faire Teams, Ergebnisse und Statistiken fuer eure Fussballrunde in einer App - statt verstreut in der WhatsApp-Gruppe, auf Zetteln und in Excel-Tabellen.</p>
          <div className="heroActions">
            <a className="primaryButton" href="#funktionen">Funktionen entdecken <span aria-hidden="true">v</span></a>
            <span className="platformLine"><i /> iOS · Android</span>
          </div>
        </div>
        <div className="heroNote" aria-label="Gruppenversprechen">
          <span className="lockMark">●</span>
          <p><strong>Eure Gruppe. Eure Regeln.</strong><br />Nur Mitglieder eurer Gruppe sehen Termine, Teams und Ergebnisse.</p>
        </div>
      </section>

      <section className="product shell" id="screens" aria-label="Kickuno App-Vorschau">
        <div className="sliderHeader">
          <div>
            <p className="eyebrow"><span /> App-Vorschau</p>
            <h2>Horizontal durch die App sliden</h2>
          </div>
        </div>

        <div className="carouselShell">
          <button type="button" className="carouselArrow carouselArrowLeft" aria-label="Vorheriges Bild" onClick={goToPreviousSlide}>←</button>
          <div
            className="carouselViewport"
            onTouchStart={handleSliderTouchStart}
            onTouchEnd={handleSliderTouchEnd}
          >
            <div className="carouselTrack" style={{ transform: `translateX(-${activeSlide * 100}%)` }}>
              {galleryImages.map((image, index) => (
                <article className="slideCard" key={image.src} aria-hidden={index !== activeSlide}>
                  <div className="realAppFrame">
                    <ScreenshotImage src={image.src} alt={image.alt} onClick={() => openLightbox(index)} />
                  </div>
                  <div className="showcaseMeta">
                    <small>{image.label}</small>
                    <strong>{image.caption}</strong>
                    <span>Tippen fuer Vollansicht</span>
                  </div>
                </article>
              ))}
            </div>
          </div>
          <button type="button" className="carouselArrow carouselArrowRight" aria-label="Naechstes Bild" onClick={goToNextSlide}>→</button>
        </div>

        <div className="carouselDots" aria-label="Slide Auswahl">
          {galleryImages.map((image, index) => (
            <button
              type="button"
              key={image.src}
              className={index === activeSlide ? "isActive" : ""}
              aria-label={`Gehe zu ${image.label}`}
              onClick={() => setActiveSlide(index)}
            />
          ))}
        </div>
      </section>

      <section className="proofBand">
        <div className="shell proofGrid">
          <p>Eine App.<br /><strong>Die ganze Fussballrunde.</strong></p>
          <div><b>4</b><span>Kernbereiche</span></div>
          <div><b>2</b><span>Sprachen · DE / EN</span></div>
          <div><b>0</b><span>WhatsApp-Chaos</span></div>
        </div>
      </section>

      <section className="features shell" id="funktionen">
        <div className="sectionIntro"><p className="eyebrow"><span /> Die wichtigsten Funktionen</p><h2>Alles zwischen<br />"wer kommt?" und <em>"wer hat gewonnen?"</em></h2></div>
        <div className="featureSplit">
          <article className="featureGroup">
            <header>
              <p className="eyebrow"><span /> Spieltag</p>
              <h3>Von der Zusage zum Ergebnis</h3>
            </header>
            <div className="featureGrid modeGrid">{fixtureFeatures.map((feature) => <article key={feature.number}><span>{feature.number}</span><h3>{feature.title}</h3><p>{feature.text}</p></article>)}</div>
          </article>
          <article className="featureGroup">
            <header>
              <p className="eyebrow"><span /> Gruppe & Statistik</p>
              <h3>Fuer die ganze Saison</h3>
            </header>
            <div className="featureGrid modeGrid">{groupFeatures.map((feature) => <article key={feature.number}><span>{feature.number}</span><h3>{feature.title}</h3><p>{feature.text}</p></article>)}</div>
          </article>
        </div>
      </section>

      <section className="workflow shell">
        <div className="workflowCopy">
          <p className="eyebrow light"><span /> So laeuft ein Spieltag</p>
          <h2>Vom "wer kommt?"<br />zum <em>Ergebnis.</em></h2>
          <p>Kickuno begleitet eure Runde vom ersten Termin bis zur Saisonstatistik - ohne WhatsApp-Threads und Excel-Tabellen.</p>
        </div>
        <ol>
          <li><span>1</span><div><strong>Termin anlegen</strong><p>Halle, Uhrzeit und optionale woechentliche Wiederholung festlegen. Jeder sagt mit einem Tipp zu oder ab.</p></div></li>
          <li><span>2</span><div><strong>Teams bilden</strong><p>Automatisch nach Staerke ausbalancieren lassen oder Spieler per Fingertipp zwischen den Teams verschieben.</p></div></li>
          <li><span>3</span><div><strong>Ergebnis erfassen</strong><p>Tore, Eigentore und Spieler des Abends eintragen - der Spielstand wird live berechnet.</p></div></li>
          <li><span>4</span><div><strong>Statistik verfolgen</strong><p>Torschuetzenliste, Siegquote und Formkurve aktualisieren sich automatisch, pro Saison und ueber die Vereinsgeschichte hinweg.</p></div></li>
        </ol>
      </section>

      <section className="platforms shell" id="gruppe">
        <div><p className="eyebrow"><span /> Ihr entscheidet</p><h2>Eure Gruppe,<br /><em>eure Regeln.</em></h2></div>
        <div className="platformCards">
          <article><b>✓</b><strong>RSVP</strong><span>Zu- und Absagen pro Termin</span></article>
          <article><b>⚖</b><strong>Auto-Ausgleich</strong><span>Teams automatisch balancieren</span></article>
          <article><b>◆</b><strong>Staerke-Bewertung</strong><span>Spielstaerke pro Spieler</span></article>
          <article><b>★</b><strong>MVP</strong><span>Spieler des Abends waehlen</span></article>
        </div>
      </section>

      <section className="closing">
        <div className="shell closingInner"><LogoMark large /><p>Keine WhatsApp-Threads mehr.<br />Keine Excel-Tabelle fuer die Tabelle.</p><h2>Euer naechster Kick,<br /><em>bestorganisiert.</em></h2><a href="#top">Nach oben <span>↑</span></a></div>
      </section>

      <footer className="footer shell">
        <div className="brand"><LogoMark /><span className="wordmark">Kick<em>u</em>no</span></div>
        <p>Eure Fussballrunde, organisiert.</p>
        <div className="legalLinks"><a href="/imprint">Impressum</a><a href="/privacy">Datenschutz</a></div>
        <span>© {new Date().getFullYear()} Kickuno · MeeCode</span>
      </footer>
    </main>
  );
}
