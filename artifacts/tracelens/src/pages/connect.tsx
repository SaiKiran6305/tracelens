import { useLocation } from "wouter";
import { PageHeader } from "@/components/bits";
import { ProjectForm } from "@/components/project-form";
import { useCreateProject } from "@/lib/project-api";
import { useToast } from "@/hooks/use-toast";
import { errMessage } from "@/lib/trace";

export default function ConnectProject() {
  const create = useCreateProject();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow="Connect application" title="Tell TraceLens what success looks like" />
      <p className="-mt-6 mb-8 text-muted-foreground">Creating a project does not contact your application. It's unverified until the SDK completes a handshake from one of your allowed origins.</p>
      <div className="rounded-3xl border border-border bg-card p-6 md:p-8">
        <ProjectForm
          submitLabel="Create project"
          pending={create.isPending}
          serverError={create.isError ? errMessage(create.error) : null}
          onSubmit={(data) => create.mutate(data, {
            onSuccess: (p) => { toast({ title: "Project created", description: "Next: install the SDK and verify." }); setLocation(`/projects/${p.id}`); },
          })}
        />
      </div>
    </div>
  );
}
