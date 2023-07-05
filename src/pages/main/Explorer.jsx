import { useEffect, useState } from "react"
import { v4 as uuid4 } from 'uuid'
import { useIndexedDB } from "react-indexed-db-hook"
import { useNavigate, useParams } from "react-router-dom"

import Grid from '@mui/material/Grid';
import Box from '@mui/material/Box';

import Folder from "../../components/Folder"
import File from "../../components/File"
import uploadFile from "../../utils/uploadFile"
import WorkingDir from "../../components/WorkingDir"
import CreateFolder from "../../components/CreateFolder";

export default function Explorer() {

    const { parentID } = useParams()
    const [workDir, setWorkDir] = useState([{
        id: undefined,
        name: 'Home'
    }])

    const { add, openCursor, deleteRecord, getByID } = useIndexedDB('file')
    const navigate = useNavigate()

    const [data, setData] = useState([])
    const [back, setBack] = useState(undefined)

    useEffect(() => {
        fetchData()
        findParent()
    }, [parentID])

    function fetchData() {
        let _data = []
        openCursor((e) => {
            var cursor = e.target.result;
            if (cursor) {
                if (cursor.value.parent === parentID)
                    _data = [..._data, cursor.value]
                cursor.continue();
            } else {
                setData(_data)
            }
        })
    }

    function findParent() {
        if (!parentID) return
        getByID(parentID)
            .then((e) => { setBack(e.parent) })
            .catch((e) => { console.log(e) })
    }


    function deleteItem(id) {
        console.log('delete', id)
        deleteRecord(id)
            .then((e) => { console.log(e) })
            .catch((e) => { console.log(e) })
        fetchData()
    }

    function handlerUploadFile(file) {
        console.log('handlerUploadFile')
        uploadFile(file)
            .then((res) => {
                console.log(res, 'handlerUploadFile')
                let data = {
                    id: uuid4(),
                    name: file.name,
                    type: 'file',
                    file_id: res.id
                }
                if (parentID) data['parent'] = parentID
                add(data)
                    .then((e) => { console.log(e) })
                    .catch((e) => { console.log(e) })
                fetchData()
            })
    }

    return (
        <>
            <WorkingDir workDir={workDir} setWorkDir={setWorkDir} />
            <h3>Folders</h3>
            <Box
            // on
            >
                <Grid container rowSpacing={1} columnSpacing={{ xs: .5, sm: 7, md: 1 }} m={.5}>
                    {
                        data?.map((item) => {
                            switch (item.type) {
                                case 'folder':
                                    return <Folder
                                        key={item.id}
                                        id={item.id}
                                        name={item.name}
                                        deleteItem={deleteItem}
                                        workDir={workDir}
                                        setWorkDir={setWorkDir}
                                    />
                                case 'file':
                                    return <File
                                        key={item.id}
                                        id={item.id}
                                        name={item.name}
                                        file_id={item.file_id}
                                        deleteItem={deleteItem}
                                    />
                                default:
                                    return null
                            }
                        })
                    }
                </Grid>
                {/* <Button
                variant="outlined"

                startIcon={<ArrowBackIcon />}
                onClick={() => {
                    if (back) navigate(`/folder/${back}`)
                    else navigate('/')
                }}
            >
                Back
            </Button> */}
                <br />
                <input
                    type="file"
                    onChange={(e) => handlerUploadFile(e.target.files[0])}
                />
                <br />
                <CreateFolder
                    parentID={parentID}
                    fetchData={fetchData}
                />
            </Box>
        </>
    )
}

