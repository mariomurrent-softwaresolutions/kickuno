import Link from "next/link";
import { buildMetadata } from "../site-metadata";

export const metadata = buildMetadata({
  title: "Impressum | Kickuno",
  path: "/imprint",
});

export default function ImprintPage() {
  return <main className="legalPage">
    <nav className="legalNav"><Link href="/">← Kickuno</Link><span>Offenlegung gem. § 5 ECG / § 25 MedienG</span></nav>
    <article>
      <p className="eyebrow"><span /> Rechtliches</p>
      <h1>Impressum</h1>
      <p className="legalLead">Informationen über den Betreiber der Kickuno App und Website.</p>
      <p className="legalNotice">Dieser Entwurf dient der Information und ersetzt keine rechtliche Beratung. Bitte vor Veröffentlichung fachkundig prüfen lassen.</p>
      <section><h2>Betreiber der Website</h2><dl>
        <div><dt>Unternehmen</dt><dd>MeeCode by Mario Murrent</dd></div>
        <div><dt>Inhaber</dt><dd>Mario Murrent</dd></div>
        <div><dt>Anschrift</dt><dd>Erzherzogin Isabelle Straße 42<br />2500 Baden, Österreich</dd></div>
        <div><dt>Sitz</dt><dd>Wiener Neustadt, Österreich</dd></div>
        <div><dt>E-Mail</dt><dd><a href="mailto:office@meecode.at">office@meecode.at</a></dd></div>
        <div><dt>Telefon</dt><dd><a href="tel:+436763074808">+43 676 3074808</a></dd></div>
        <div><dt>UID-Nummer</dt><dd>ATU69801324</dd></div>
      </dl></section>
      <section><h2>Zweck dieser Website</h2><p>Diese Website stellt Kickuno vor, eine App zur Organisation von Terminen, Teams, Ergebnissen und Statistiken für feste Fußballrunden.</p></section>
      <section><h2>Haftung</h2><p>Die Inhalte dieser Website wurden mit Sorgfalt erstellt. Es wird jedoch keine Gewähr für Vollständigkeit, Aktualität oder Richtigkeit übernommen. Für Inhalte externer, verlinkter Websites sind ausschließlich deren Betreiber verantwortlich.</p></section>
      <section><h2>Urheberrecht</h2><p>Sofern nicht anders angegeben, unterliegen Inhalte und Gestaltung dieser Website dem Urheberrecht. Eine Nutzung über die gesetzlichen Schranken hinaus bedarf der Zustimmung des Betreibers.</p></section>
      <section><h2>Quelle der Betreiberangaben</h2><p>Die hier angegebenen Betreiberdaten entsprechen den von MeeCode veröffentlichten Angaben. Siehe auch die <a href="https://meecode.at/privacy/" target="_blank" rel="noreferrer">rechtlichen Informationen von MeeCode</a>.</p></section>
    </article>
    <footer className="legalFooter"><Link href="/privacy">Datenschutz</Link><Link href="/">Zurück zu Kickuno</Link></footer>
  </main>;
}
