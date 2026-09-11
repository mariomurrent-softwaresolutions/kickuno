export default function HomePage() {
  return (
    <main style={{ padding: 40, maxWidth: 640 }}>
      <h1>Hallenkick CMS</h1>
      <p>
        Backend for the Hallenkick app. Visit <a href="/admin">/admin</a> for the Payload
        dashboard. See <code>documentation/implementation-plan.md</code> for the full API surface
        and collection design.
      </p>
    </main>
  );
}
