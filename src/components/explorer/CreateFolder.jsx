import { useState } from "react";
import { v4 as uuid4 } from "uuid";
import { LoaderCircle, FolderPlus } from "lucide-react";
import { db } from "../../db/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";

export default function CreateFolder({ parentID, fetchData, open, setOpen }) {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    async function addFolder(event) {
        event.preventDefault();
        setIsLoading(true);
        setError("");
        const data = {
            id: uuid4(),
            name: new FormData(event.currentTarget).get("name"),
            type: "folder",
        };
        if (parentID) data.parent = parentID;
        try {
            await (await db).add("file", data);
            await fetchData();
            setOpen(false);
        } catch {
            setError("Couldn't create the folder. Please try again.");
        } finally {
            setIsLoading(false);
        }
    }
    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                setOpen(next);
                setError("");
            }}
        >
            <DialogContent>
                <DialogHeader>
                    <p className="eyebrow mb-2">01 / Organize</p>
                    <DialogTitle>Make some space.</DialogTitle>
                    <DialogDescription>
                        Create a folder in your current location.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={addFolder} className="space-y-6">
                    <div className="space-y-2">
                        <Label htmlFor="folder-name">Folder name</Label>
                        <Input
                            id="folder-name"
                            name="name"
                            placeholder="Project files"
                            required
                            autoFocus
                        />
                    </div>
                    {error && (
                        <p role="alert" className="text-sm">
                            {error}
                        </p>
                    )}
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isLoading}>
                            {isLoading ? (
                                <LoaderCircle className="animate-spin" />
                            ) : (
                                <FolderPlus />
                            )}
                            Create folder
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
