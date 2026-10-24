import { useState } from "react";
import { Plus, FolderPlus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import CreateFolder from "./CreateFolder";
import UploadFile from "./UploadFile";

export default function CreateButton({ parentID, fetchData }) {
    const [openCreateFolder, setOpenCreateFolder] = useState(false);
    const [openUploadFile, setOpenUploadFile] = useState(false);
    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button size="sm">
                        <Plus aria-hidden="true" />
                        New
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setOpenUploadFile(true)}>
                        <Upload aria-hidden="true" />
                        Upload file
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onSelect={() => setOpenCreateFolder(true)}
                    >
                        <FolderPlus aria-hidden="true" />
                        New folder
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            <CreateFolder
                parentID={parentID}
                fetchData={fetchData}
                open={openCreateFolder}
                setOpen={setOpenCreateFolder}
            />
            <UploadFile
                parentID={parentID}
                fetchData={fetchData}
                open={openUploadFile}
                setOpen={setOpenUploadFile}
            />
        </>
    );
}
