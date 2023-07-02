import { useEffect, useState } from "react"

import storage from "../../utils/storage"
import Folder from "../../components/Folder"
import File from "../../components/File"
import client from "../../services/telegram"
import { CustomFile } from "telegram/client/uploads"

export default function Explorer() {

    const [isLoading, setIsLoading] = useState(true)
    const [data, setData] = useState([])

    useEffect(() => {
        if (data.length === 0 && isLoading) {
            update()
            setIsLoading(false)
        }
    }, [data])

    function update() {
        const _data = storage.getData()
        if (_data) setData(_data)
    }

    async function uploadFile(file) {

        const toUpload = new CustomFile(file.name, file.size, '', file.arrayBuffer())

        const result = await client.sendFile('MQ_XZ', {
            file: toUpload,
            workers: 1,
            forceDocument: true
        });

        console.log(result); // prints the result
    }

    return (
        <>
            <h1>Folder</h1>
            {
                data?.map((item) => {
                    switch (item.type) {
                        case 'folder':
                            return <Folder id={item.id} name={item.name} />
                        case 'file':
                            return <File id={item.id} name={item.name} />
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
            <input
                type="submit"
                value='Add New folder'
                onClick={() => {
                    setIsLoading(true)
                    storage.newFolder()
                    update()
                }}
            />
        </>
    )
}

