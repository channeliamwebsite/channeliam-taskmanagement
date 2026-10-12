"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateMyName } from "@/lib/actions/profile";

export function ProfileForm({ fullName }: { fullName: string }) {
  const [name, setName] = useState(fullName);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const r = await updateMyName(name);
      if (r.ok) toast.success("Profile updated");
      else toast.error(r.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="grid flex-1 gap-1.5">
        <Label htmlFor="profile-name">Full name</Label>
        <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} className="h-9" />
      </div>
      <Button type="submit" className="h-9" disabled={pending || !name.trim() || name === fullName}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Save
      </Button>
    </form>
  );
}
