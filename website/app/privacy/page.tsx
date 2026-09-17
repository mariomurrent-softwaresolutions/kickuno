import Link from "next/link";
import { buildMetadata } from "../site-metadata";

export const metadata = buildMetadata({
  title: "Datenschutz | Kickuno",
  path: "/privacy",
});

export default function PrivacyPage() {
  return <main className="legalPage">
    <nav className="legalNav"><Link href="/">← Kickuno</Link><span>Stand: 16. September 2026</span></nav>
    <article>
      <p className="eyebrow"><span /> Rechtliches</p>
      <h1>Datenschutz</h1>
      <p className="legalLead">Diese Erklärung beschreibt, welche Daten die Kickuno App und diese Website verarbeiten und warum.</p>
      <p className="legalNotice">Dieser Entwurf dient der Information und ersetzt keine rechtliche Beratung. Vor der Veröffentlichung sollte er von einer fachkundigen Stelle geprüft werden – insbesondere sobald weitere Dienste (z.&nbsp;B. Push-Benachrichtigungen oder ein konkreter Hosting-Anbieter) feststehen.</p>
      <section><h2>Verantwortlicher</h2><dl>
        <div><dt>Verantwortlicher</dt><dd>MeeCode by Mario Murrent</dd></div>
        <div><dt>Inhaber</dt><dd>Mario Murrent</dd></div>
        <div><dt>Anschrift</dt><dd>Erzherzogin Isabelle Straße 42<br />2500 Baden, Österreich</dd></div>
        <div><dt>E-Mail</dt><dd><a href="mailto:office@meecode.at">office@meecode.at</a></dd></div>
        <div><dt>Telefon</dt><dd><a href="tel:+436763074808">+43 676 3074808</a></dd></div>
      </dl></section>
      <section><h2>Diese Website</h2><p>Die Kickuno-Website ist eine reine Informationsseite. Sie enthält keine Kontaktformulare, keine Analyse- oder Werbe-Cookies und keine Einbindung von Drittanbieter-Trackern. Beim Aufruf verarbeitet der Hosting-Anbieter technisch notwendige Verbindungsdaten (z.&nbsp;B. IP-Adresse, Zeitpunkt der Anfrage, aufgerufene Seite, Browserinformationen) zur Auslieferung und Absicherung der Seite. Es werden keine Cookies zu Tracking- oder Marketingzwecken gesetzt.</p></section>
      <section><h2>Die Kickuno App</h2><p>Für die Nutzung der Kickuno App wird ein Benutzerkonto benötigt. Dabei erfassen wir ausschließlich folgende Kontodaten:</p>
        <ul>
          <li><strong>Benutzername</strong></li>
          <li><strong>Passwort</strong> (sicher gespeichert, nicht im Klartext)</li>
        </ul>
        <p>Es werden keine weiteren personenbezogenen Daten erhoben.</p>
      </section>
      <section><h2>Sichtbarkeit innerhalb einer Gruppe</h2><p>Name, Zusagen, Teamzuteilungen, Ergebnisse und Statistiken sind für andere Mitglieder derselben Gruppe sichtbar – das ist der Zweck der App. Außerhalb der eigenen Gruppe(n) sind diese Daten nicht einsehbar. Admins und Organisatoren einer Gruppe können zusätzlich Verwaltungsdaten wie die Spielstärke oder einen Spitznamen für Mitglieder ihrer Gruppe einsehen und pflegen.</p></section>
      <section><h2>Hosting und Empfänger</h2><p>Konto-, Gruppen- und Spieldaten werden auf Servern verarbeitet, die für uns von einem Hosting-Anbieter betrieben werden. Der Zugriff ist auf die für den Betrieb notwendigen Personen und Systeme beschränkt. Es findet keine Weitergabe von Daten zu Werbezwecken statt, und es werden keine Nutzerprofile für Dritte erstellt oder verkauft.</p></section>
      <section><h2>Speicherdauer</h2><p>Kontodaten werden gespeichert, solange das Benutzerkonto besteht. Termin-, Zusage- und Ergebnisdaten bleiben Teil der Vereins- bzw. Gruppenhistorie und werden auch nach Ablauf einer Saison aufbewahrt, damit die Statistikfunktion sinnvoll nutzbar bleibt. Auf Wunsch kann ein Konto gelöscht werden; bereits mit anderen Mitgliedern geteilte Spieldaten (z.&nbsp;B. erzielte Tore in einem gemeinsamen Match) können aus technischen Gründen in anonymisierter oder zugeordneter Form in der Gruppenhistorie verbleiben.</p></section>
      <section><h2>Eure Rechte</h2><p>Ihr habt nach der DSGVO unter anderem das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit sowie Widerspruch gegen bestimmte Verarbeitungen. Zusätzlich besteht ein Beschwerderecht bei der zuständigen Aufsichtsbehörde (in Österreich: die Datenschutzbehörde). Zur Ausübung eurer Rechte genügt eine formlose Nachricht an <a href="mailto:office@meecode.at">office@meecode.at</a>.</p></section>
      <section><h2>Minderjährige</h2><p>Kickuno richtet sich nicht gezielt an Kinder. Nutzer unter 14 Jahren sollten die App nur mit Zustimmung eines Erziehungsberechtigten verwenden.</p></section>
      <section><h2>Änderungen dieser Erklärung</h2><p>Diese Datenschutzerklärung wird angepasst, sobald sich der Funktionsumfang der App ändert – etwa bei Einführung von Push-Benachrichtigungen oder weiteren Diensten Dritter. Die jeweils aktuelle Fassung ist auf dieser Seite abrufbar.</p></section>
      <section><h2>Weitere Informationen</h2><p>Allgemeine Datenschutzinformationen zu MeeCode findet ihr auf der <a href="https://meecode.at/privacy/" target="_blank" rel="noreferrer">MeeCode-Datenschutzseite</a>.</p></section>
    </article>
    <footer className="legalFooter"><Link href="/imprint">Impressum</Link><Link href="/">Zurück zu Kickuno</Link></footer>
  </main>;
}
