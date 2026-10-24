import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { Store } from "../../redux/store";
import { authenticateUser } from "../../redux/actions/authAction";
import {
    db,
    selectCatalog,
    releaseCatalog,
    writeCatalog,
} from "../../db/config";
import UploadFile from "./UploadFile";

const { upload } = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock("../../utils/uploadFile", () => ({ default: upload }));
let account,
    counter = 0;
beforeEach(async () => {
    account = `upload-${++counter}`;
    await selectCatalog(account);
    Store.dispatch(authenticateUser({ id: account }));
    upload.mockReset();
});
afterEach(() => {
    cleanup();
    releaseCatalog();
    Store.dispatch({ type: "LOGOUT_SUCCESS" });
});
function setup() {
    const closed = vi.fn(),
        refreshed = vi.fn();
    render(
        <Provider store={Store}>
            <UploadFile open setOpen={closed} fetchData={refreshed} />
        </Provider>,
    );
    return { user: userEvent.setup(), closed, refreshed };
}
describe("upload queue", () => {
    it("keeps completed uploads and retries only unfinished files", async () => {
        upload
            .mockResolvedValueOnce({ id: 11 })
            .mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValueOnce({ id: 12 });
        const { user, closed } = setup();
        await user.upload(screen.getByLabelText("Choose files"), [
            new File(["one"], "one.txt"),
            new File(["two"], "two.txt"),
        ]);
        await user.click(screen.getByRole("button", { name: "Upload files" }));
        await screen.findByRole("button", { name: "Retry unfinished files" });
        expect(await (await db).count("file")).toBe(1);
        expect(closed).not.toHaveBeenCalled();
        await user.click(
            screen.getByRole("button", { name: "Retry unfinished files" }),
        );
        await waitFor(() => expect(closed).toHaveBeenCalledWith(false));
        expect(upload).toHaveBeenCalledTimes(3);
        expect(await (await db).count("file")).toBe(2);
        expect(upload.mock.calls.map((call) => call[1].name)).toEqual([
            "one.txt",
            "two.txt",
            "two.txt",
        ]);
        expect(
            (await (await db).getAll("file")).every(
                (item) => item.size === 3 && item.createdAt,
            ),
        ).toBe(true);
    });
    it("retries metadata persistence without sending the file again", async () => {
        upload.mockResolvedValue({ id: 21 });
        await writeCatalog(
            "put",
            { id: "parent", name: "Parent", type: "folder" },
            account,
        );
        const { user, closed } = setup();
        const original = IDBObjectStore.prototype.put;
        let fail = true;
        vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
            value,
            ...args
        ) {
            if (value.name === "notes.txt" && fail) {
                fail = false;
                throw new Error("Storage failure");
            }
            return original.call(this, value, ...args);
        });
        await user.upload(
            screen.getByLabelText("Choose files"),
            new File(["notes"], "notes.txt"),
        );
        await user.click(screen.getByRole("button", { name: "Upload files" }));
        await screen.findByRole("button", { name: "Retry saving" });
        await user.click(screen.getByRole("button", { name: "Retry saving" }));
        await waitFor(() => expect(closed).toHaveBeenCalledWith(false));
        expect(upload).toHaveBeenCalledOnce();
        expect(await (await db).count("file")).toBe(2);
        vi.restoreAllMocks();
    });
    it("stops the queue and leaves remaining files available to retry", async () => {
        upload.mockImplementation(
            (_id, _file, { signal }) =>
                new Promise((_, reject) =>
                    signal.addEventListener(
                        "abort",
                        () =>
                            reject(new DOMException("Cancelled", "AbortError")),
                        { once: true },
                    ),
                ),
        );
        const { user, closed } = setup();
        await user.upload(screen.getByLabelText("Choose files"), [
            new File(["one"], "one.txt"),
            new File(["two"], "two.txt"),
        ]);
        await user.click(screen.getByRole("button", { name: "Upload files" }));
        await user.click(screen.getByRole("button", { name: "Stop uploads" }));
        await screen.findByRole("button", { name: "Retry unfinished files" });
        expect(upload).toHaveBeenCalledOnce();
        expect(await (await db).count("file")).toBe(0);
        expect(closed).not.toHaveBeenCalled();
    });
});
