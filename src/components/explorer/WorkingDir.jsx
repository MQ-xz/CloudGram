import { Fragment } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { db } from "../../db/config";
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export default function WorkingDir({ workDir, setWorkDir }) {
    const navigate = useNavigate();
    const { parentID } = useParams();

    async function goBack() {
        const folder = await (await db).get("file", parentID);
        const parent = folder?.parent;
        const parentIndex = workDir.findIndex((item) => item.id === parent);
        setWorkDir(workDir.slice(0, parentIndex >= 0 ? parentIndex + 1 : 1));
        navigate(parent ? `/folder/${parent}` : "/");
    }

    return (
        <div className="flex min-h-8 items-center justify-between gap-3">
            <Breadcrumb className="min-w-0 flex-1">
                <BreadcrumbList className="flex-wrap text-xs">
                    {workDir.map((item, index) => (
                        <Fragment key={item.id || "home"}>
                            {index > 0 && <BreadcrumbSeparator />}
                            <BreadcrumbItem>
                                {index === workDir.length - 1 ? (
                                    <BreadcrumbPage className="flex items-center gap-2 break-all">
                                        {index === 0 && (
                                            <Home
                                                className="size-3.5"
                                                aria-hidden="true"
                                            />
                                        )}
                                        {item.name}
                                    </BreadcrumbPage>
                                ) : (
                                    <BreadcrumbLink asChild>
                                        <Link
                                            to={
                                                item.id
                                                    ? `/folder/${item.id}`
                                                    : "/"
                                            }
                                            onClick={() =>
                                                setWorkDir(
                                                    workDir.slice(0, index + 1),
                                                )
                                            }
                                            className="flex items-center gap-2 break-all"
                                        >
                                            {index === 0 && (
                                                <Home
                                                    className="size-3.5"
                                                    aria-hidden="true"
                                                />
                                            )}
                                            {item.name}
                                        </Link>
                                    </BreadcrumbLink>
                                )}
                            </BreadcrumbItem>
                        </Fragment>
                    ))}
                </BreadcrumbList>
            </Breadcrumb>
            {parentID && (
                <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={goBack}
                    aria-label="Back to parent folder"
                >
                    <ArrowLeft aria-hidden="true" />
                    Back
                </Button>
            )}
        </div>
    );
}
