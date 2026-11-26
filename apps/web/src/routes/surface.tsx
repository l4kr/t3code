import { createFileRoute } from "@tanstack/react-router";

import { SurfaceWindowPage } from "../surfaceWindows/SurfaceWindowPage";
import { validateSurfaceWindowRouteSearch } from "../surfaceWindows/surfaceWindow";

export const Route = createFileRoute("/surface")({
  validateSearch: validateSurfaceWindowRouteSearch,
  component: function SurfaceRoute() {
    return <SurfaceWindowPage search={Route.useSearch().surface} />;
  },
});
