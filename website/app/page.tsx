import HomeGallery from "./HomeGallery";
import { buildMetadata, SITE_NAME } from "./site-metadata";

export const metadata = buildMetadata({
  title: `${SITE_NAME} – Teams. Termine. Tore.`,
  path: "/",
});

export default function Home() {
  return <HomeGallery />;
}
