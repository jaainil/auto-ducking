import { useEffect, useState } from "react";
import { Home } from "./components/Home";
import { Editor } from "./components/Editor";
import type { Project } from "./types";

type Route = { name: "home" } | { name: "project"; id: string };

function readRoute(): Route {
  const hash = window.location.hash.replace(/^#/, "");
  const match = /^\/project\/([a-z0-9]{8,32})$/.exec(hash);
  return match ? { name: "project", id: match[1] } : { name: "home" };
}

export function App() {
  const [route, setRoute] = useState<Route>(() => readRoute());

  useEffect(() => {
    const onChange = () => {
      setRoute(readRoute());
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const openProject = (id: string) => {
    window.location.hash = `/project/${id}`;
  };

  const handleCreated = (project: Project) => {
    openProject(project.id);
  };

  if (route.name === "project") {
    return (
      <Editor
        key={route.id}
        projectId={route.id}
        onBack={() => {
          window.location.hash = "/";
        }}
      />
    );
  }

  return <Home onCreated={handleCreated} onOpenProject={openProject} />;
}
