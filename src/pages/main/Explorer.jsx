import { useEffect, useState } from "react"

import Folder from "../../components/Folder"
import File from "../../components/File"

import { useIndexedDB } from "react-indexed-db-hook"
import uploadFile from "../../utils/uploadFile"

export default function Explorer() {
    const parent = null
    const [data, setData] = useState([])
    const { add, openCursor, deleteRecord } = useIndexedDB('file')

    useEffect(() => {
        fetchData()
    }, [parent])

    function fetchData() {
        let _data = []
        openCursor((e) => {
            var cursor = e.target.result;
            if (cursor) {
                console.log(cursor.value)
                if (cursor.value.parent === parent)
                    _data = [..._data, cursor.value]
                cursor.continue();
            } else {
                console.log('No more entries!');
                setData(_data)
            }
        })
    }

    function addFolder() {
        console.log('addFolder')
        let data = {
            name: 'new',
            type: 'folder',
            parent: null
        }
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
            {
                data?.map((item) => {
                    switch (item.type) {
                        case 'folder':
                            return <Folder id={item.id} name={item.name} deleteItem={deleteItem} />
                        case 'file':
                            return <File id={item.id} name={item.name} deleteItem={deleteItem} />
                        default:
                            return null
                    }
                })
            }
            <input
                type="file"
                onChange={(e) => uploadFile(e.target.files[0])}
            // onClick={(e) => {
            //     console.log(e)
            //     // setIsLoading(true)
            //     // storage.newFile()
            //     // update()
            // }}
            />
            <br />
            <input
                type="submit"
                value='Add New Folder'
                onClick={addFolder}
            />
        </>
    )
}

