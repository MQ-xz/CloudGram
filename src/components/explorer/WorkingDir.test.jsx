import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import WorkingDir from "./WorkingDir";

const path = [
    { id: undefined, name: "Home" },
    { id: "parent", name: "Projects" },
    { id: "child", name: "Reports" },
];
function setup() {
    const router = createMemoryRouter(
        [{ path: "*", element: <WorkingDir workDir={path} /> }],
        { initialEntries: ["/folder/child"] },
    );
    render(<RouterProvider router={router} />);
    return router;
}
describe("folder breadcrumbs", () => {
    it("links every ancestor and sends Back to the real parent", async () => {
        const router = setup();
        const user = userEvent.setup();
        expect(
            screen.getByRole("link", { name: "Home" }).getAttribute("href"),
        ).toBe("/");
        expect(
            screen.getByRole("link", { name: "Projects" }).getAttribute("href"),
        ).toBe("/folder/parent");
        await user.click(
            screen.getByRole("link", { name: "Back to parent folder" }),
        );
        expect(router.state.location.pathname).toBe("/folder/parent");
    });
    it("supports keyboard navigation", async () => {
        const router = setup();
        const user = userEvent.setup();
        screen.getByRole("link", { name: "Home" }).focus();
        await user.keyboard("{Enter}");
        expect(router.state.location.pathname).toBe("/");
    });
});
