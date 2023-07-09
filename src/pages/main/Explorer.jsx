import { useEffect, useState } from "react";
import { useIndexedDB } from "react-indexed-db-hook";
import { useParams } from "react-router-dom";

import { Grid, Typography, Container } from "@mui/material";

import Folder from "../../components/explorer/Folder";
import File from "../../components/explorer/File";
import WorkingDir from "../../components/explorer/WorkingDir";
import CreateButton from "../../components/explorer/CreateButton";

export default function Explorer() {
    const { parentID } = useParams();
    const [workDir, setWorkDir] = useState([
        {
            id: undefined,
            name: "Home",
        },
    ]);

    const { openCursor, deleteRecord } = useIndexedDB("file");

    const [data, setData] = useState([]);

    useEffect(() => {
        fetchData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [parentID]);

    function fetchData() {
        let _data = [];
        openCursor((e) => {
            var cursor = e.target.result;
            if (cursor) {
                if (cursor.value.parent === parentID)
                    _data = [..._data, cursor.value];
                cursor.continue();
            } else {
                setData(_data);
            }
        });
    }

    function deleteItem(id) {
        console.log("delete", id);
        deleteRecord(id)
            .then((e) => {
                console.log(e);
            })
            .catch((e) => {
                console.log(e);
            });
        fetchData();
    }

    return (
        <>
            <WorkingDir workDir={workDir} setWorkDir={setWorkDir} />
            <h3>Folders</h3>
            <Grid
                container
                rowSpacing={1}
                columnSpacing={{ xs: 0.5, sm: 7, md: 1 }}
                m={0.5}
            >
                {data.length ? (
                    data?.map((item) => {
                        switch (item.type) {
                            case "folder":
                                return (
                                    <Folder
                                        key={item.id}
                                        id={item.id}
                                        name={item.name}
                                        // deleteItem={deleteItem}
                                        workDir={workDir}
                                        setWorkDir={setWorkDir}
                                    />
                                );
                            case "file":
                                return (
                                    <File
                                        key={item.id}
                                        id={item.id}
                                        name={item.name}
                                        file_id={item.file_id}
                                        deleteItem={deleteItem}
                                    />
                                );
                            default:
                                return null;
                        }
                    })
                ) : (
                    <Container>
                        <Typography variant="body" align="center" gutterBottom>
                            There is nothing to show here, please upload some
                            file or create some folders.
                        </Typography>
                    </Container>
                )}
            </Grid>
            <CreateButton parentID={parentID} fetchData={fetchData} />
        </>
    );
}
