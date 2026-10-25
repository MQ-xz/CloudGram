import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
    render,
    screen,
    within,
    cleanup,
    waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { Store } from "../../redux/store";
import { authenticateUser } from "../../redux/actions/authAction";
import {
    db,
    selectCatalog,
    releaseCatalog,
    writeCatalog,
} from "../../db/config";
const { telegram } = vi.hoisted(() => ({
    telegram: { getMessages: vi.fn(), deleteMessages: vi.fn() },
}));
vi.mock("../../services/telegram", () => ({ default: telegram }));
import Explorer from "./Explorer";
let account,
    sequence = 0;
beforeEach(async () => {
    account = `explorer-${++sequence}`;
    await selectCatalog(account);
    Store.dispatch(authenticateUser({ id: account }));
    telegram.getMessages.mockReset().mockResolvedValue([]);
    telegram.deleteMessages.mockReset().mockResolvedValue([]);
});
afterEach(() => {
    cleanup();
    releaseCatalog();
    Store.dispatch({ type: "LOGOUT_SUCCESS" });
});
const put = (item) => writeCatalog("put", item, account);
function setup(path = "/") {
    const router = createMemoryRouter(
        [
            { path: "/", element: <Explorer /> },
            { path: "/folder/:parentID", element: <Explorer /> },
        ],
        { initialEntries: [path] },
    );
    render(
        <Provider store={Store}>
            <RouterProvider router={router} />
        </Provider>,
    );
    return { router, user: userEvent.setup() };
}
describe("file explorer", () => {
    it("rebuilds breadcrumb titles on direct links and browser back/forward", async () => {
        await put({ id: "parent", name: "Projects", type: "folder" });
        await put({
            id: "child",
            name: "Reports",
            type: "folder",
            parent: "parent",
        });
        const { router, user } = setup("/folder/child");
        await screen.findByRole("heading", { name: "Reports" });
        await user.click(
            screen.getByRole("link", { name: "Back to parent folder" }),
        );
        await screen.findByRole("heading", { name: "Projects" });
        await router.navigate(-1);
        await screen.findByRole("heading", { name: "Reports" });
        await router.navigate(1);
        await screen.findByRole("heading", { name: "Projects" });
    });
    it("filters the current folder and sorts known file sizes", async () => {
        await put({ id: "folder", name: "Projects", type: "folder" });
        await put({
            id: "small",
            name: "small.txt",
            type: "file",
            size: 1,
            file_id: 1,
            createdAt: "2026-01-01T00:00:00Z",
        });
        await put({
            id: "large",
            name: "large.txt",
            type: "file",
            size: 100,
            file_id: 2,
            createdAt: "2026-02-01T00:00:00Z",
        });
        const { user } = setup();
        const list = await screen.findByRole("list", {
            name: "Files and folders",
        });
        await user.selectOptions(
            screen.getByRole("combobox", { name: "Sort files" }),
            "size-desc",
        );
        expect(
            within(list)
                .getAllByRole("listitem")
                .map((item) => item.textContent),
        ).toEqual([
            expect.stringContaining("Projects"),
            expect.stringContaining("large.txt"),
            expect.stringContaining("small.txt"),
        ]);
        await user.type(
            screen.getByRole("searchbox", { name: "Search this folder" }),
            "small",
        );
        expect(within(list).getAllByRole("listitem")).toHaveLength(1);
        expect(list.textContent).toContain("small.txt");
    });
    it("renames and moves folders through the action dialog", async () => {
        await put({ id: "one", name: "Alpha", type: "folder" });
        await put({ id: "two", name: "Destination", type: "folder" });
        const { user } = setup();
        await screen.findByRole("link", { name: "Open folder Alpha" });
        await user.click(
            screen.getByRole("button", { name: "Actions for folder Alpha" }),
        );
        await user.click(
            screen.getByRole("menuitem", { name: "Rename folder" }),
        );
        await user.clear(screen.getByRole("textbox", { name: "Folder name" }));
        await user.type(
            screen.getByRole("textbox", { name: "Folder name" }),
            "Renamed",
        );
        await user.click(screen.getByRole("button", { name: "Save changes" }));
        await screen.findByRole("link", { name: "Open folder Renamed" });
        await user.click(
            screen.getByRole("button", { name: "Actions for folder Renamed" }),
        );
        await user.click(screen.getByRole("menuitem", { name: "Move folder" }));
        await user.selectOptions(
            screen.getByRole("combobox", { name: "Destination folder" }),
            "two",
        );
        await user.click(screen.getByRole("button", { name: "Save changes" }));
        await waitFor(() =>
            expect(
                screen.queryByRole("dialog", { name: "Move folder" }),
            ).toBeNull(),
        );
        await user.click(
            screen.getByRole("link", { name: "Open folder Destination" }),
        );
        await screen.findByRole("link", { name: "Open folder Renamed" });
    });
    it("confirms recursive deletion before deleting the reviewed Telegram references", async () => {
        await put({ id: "folder", name: "Delete me", type: "folder" });
        await put({
            id: "file",
            name: "inside.txt",
            type: "file",
            parent: "folder",
            file_id: 99,
        });
        const { user } = setup();
        await screen.findByRole("link", { name: "Open folder Delete me" });
        await user.click(
            screen.getByRole("button", {
                name: "Actions for folder Delete me",
            }),
        );
        await user.click(
            screen.getByRole("menuitem", { name: "Delete folder" }),
        );
        expect(telegram.deleteMessages).not.toHaveBeenCalled();
        await user.click(
            await screen.findByRole("button", {
                name: "Delete folder and contents",
            }),
        );
        await waitFor(() =>
            expect(telegram.deleteMessages).toHaveBeenCalledWith("me", [99], {
                revoke: true,
            }),
        );
        await waitFor(async () =>
            expect(await (await db).count("file")).toBe(0),
        );
    });
    it("recovers from a missing folder with a Home link", async () => {
        const { user } = setup("/folder/missing");
        await screen.findByRole("alert");
        await user.click(screen.getByRole("link", { name: "Go to Home" }));
        await screen.findByRole("heading", { name: "My files" });
    });
});
