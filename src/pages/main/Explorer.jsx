import { useEffect, useState } from "react"
import { v4 as uuid4 } from 'uuid'

import Folder from "../../components/Folder"
import File from "../../components/File"

import { useIndexedDB } from "react-indexed-db-hook"
// import uploadFile from "../../utils/uploadFile"
import { useNavigate, useParams } from "react-router-dom"

export default function Explorer() {

    const { parentID } = useParams()
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

    function addFolder() {
        let data = {
            id: uuid4(),
            name: 'new',
            type: 'folder'
        }
        if (parentID) data['parent'] = parentID
        add(data)
            .then((e) => { console.log(e) })
            .catch((e) => { console.log(e) })
        fetchData()
    }

    function deleteItem(id) {
        console.log('delete', id)
        deleteRecord(id)
            .then((e) => { console.log(e) })
            .catch((e) => { console.log(e) })
        fetchData()
    }


    return (
        <>
            <h1>Folder</h1>
            <button
                onClick={() => {
                    if (back) navigate(`/folder/${back}`)
                    else navigate('/')
                }}
            >
                back
            </button>
            {
                data?.map((item) => {
                    switch (item.type) {
                        case 'folder':
                            return <Folder
                                key={item.id}
                                id={item.id}
                                name={item.name}
                                deleteItem={deleteItem}
                            />
                        case 'file':
                            return <File
                                key={item.id}
                                id={item.id}
                                name={item.name}
                                deleteItem={deleteItem}
                            />
                        default:
                            return null
                    }
                })
            }
            {/* <input
                type="file"
                onChange={(e) => uploadFile(e.target.files[0])}
            /> */}
            <br />
            <input
                type="submit"
                value='Add New Folder'
                onClick={addFolder}
            />
        </>
    )
}

