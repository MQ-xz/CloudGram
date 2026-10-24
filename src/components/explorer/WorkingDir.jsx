import { Fragment } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export default function WorkingDir({ workDir }) {
    const parent = workDir.at(-2)?.id;
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
                                            className="flex min-h-8 items-center gap-2 break-all"
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
            {workDir.length > 1 && (
                <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    aria-label="Back to parent folder"
                >
                    <Link to={parent ? `/folder/${parent}` : "/"}>
                        <ArrowLeft aria-hidden="true" />
                        Back
                    </Link>
                </Button>
            )}
        </div>
    );
}
